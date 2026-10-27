// 人物按路径区分、放在子文件夹里：逐层列出、新建命名、移动 / 改名不覆盖、外部改动、文件夹操作、全局搜索。
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { closeTagloomRuntime, tagloomPlugin } from './mod.ts'
import { type Character, contentOf, emptyContent } from '../share/mod.ts'

type Req = (path: string, init?: RequestInit) => Promise<Response>

async function withApp(fn: (req: Req, root: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: 'tagloom_folders_' })
  closeTagloomRuntime()
  const plugin = tagloomPlugin({ dataDir: dir, catalogPath: 'missing.sqlite' })
  const app = new Hono().route('/api/tagloom', plugin.api)
  const req: Req = (path, init) =>
    Promise.resolve(app.request(`/api/tagloom${path}`, init))
  try {
    await fn(req, `${dir}/characters`)
  } finally {
    closeTagloomRuntime()
    await Deno.remove(dir, { recursive: true })
  }
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const q = (params: Record<string, string>) => new URLSearchParams(params)
const listing = async (req: Req, folder = '') =>
  await (await req(`/characters?${q({ folder })}`)).json()
const item = (path: string) => `/characters/item?${q({ path })}`

async function create(
  req: Req,
  body: Record<string, unknown>,
): Promise<Character> {
  const r = await req('/characters', json(body))
  assert.equal(r.status, 201)
  return await r.json()
}

const titled = (title: string) => ({ ...emptyContent(), title })

Deno.test('characters are created in folders, named after the title, and never overwrite', async () => {
  await withApp(async (req, root) => {
    assert.equal(
      (await req('/folders', json({ path: '漫画A' }))).status,
      201,
    )
    assert.equal((await req('/folders', json({ path: '漫画A' }))).status, 409)
    assert.equal(
      (await req('/folders', json({ path: '漫画A/第1卷' }))).status,
      201,
    )
    const a = await create(req, {
      folder: '漫画A/第1卷',
      content: titled('艾莉丝'),
    })
    assert.equal(a.path, '漫画A/第1卷/艾莉丝.json')
    const b = await create(req, {
      folder: '漫画A/第1卷',
      content: titled('艾莉丝'),
    })
    assert.equal(b.path, '漫画A/第1卷/艾莉丝 (2).json')
    // 标题里的非法字符替换掉，保留名加前缀
    assert.equal(
      (await create(req, { content: titled('a/b:c?') })).path,
      'a_b_c_.json',
    )
    assert.equal(
      (await create(req, { content: titled('CON') })).path,
      '_CON.json',
    )
    // 文件里不写路径和 id
    const disk = JSON.parse(await Deno.readTextFile(`${root}/${a.path}`))
    assert.ok(!('path' in disk) && !('id' in disk))

    // 一层一层列出
    const top = await listing(req)
    assert.deepEqual(top.folders, [{ name: '漫画A', path: '漫画A' }])
    assert.equal(top.characters.length, 2)
    assert.deepEqual((await listing(req, '漫画A')).characters, [])
    const vol = await listing(req, '漫画A/第1卷')
    assert.deepEqual(
      vol.characters.map((c: { path: string }) => c.path),
      [a.path, b.path],
    )

    // 放到确切位置：已存在 409；上级文件夹不存在 404
    assert.equal(
      (await req('/characters', json({ path: a.path }))).status,
      409,
    )
    assert.equal(
      (await req('/characters', json({ path: '没有/x.json' }))).status,
      404,
    )
    // 不合法的名字
    for (
      const path of ['CON.json', 'a..json', 'a .json', '.x.json', 'x.JSON']
    ) {
      assert.equal(
        (await req('/characters', json({ path }))).status,
        422,
        path,
      )
    }
    for (const path of ['a:b', 'nul', 'x.', '../x', '']) {
      assert.equal((await req('/folders', json({ path }))).status, 422, path)
    }
  })
})

Deno.test('moving or renaming a character never overwrites and keeps its data', async () => {
  await withApp(async (req, root) => {
    await req('/folders', json({ path: '项目' }))
    const a = await create(req, { content: titled('甲') })
    const b = await create(req, { content: titled('乙') })
    const move = (c: Character, to: string, expectedVersion = c.version) =>
      req(
        `/characters/item/move?${q({ path: c.path })}`,
        json({ expectedVersion, to }),
      )

    // 目标已存在：409，两个文件都不变
    const r1 = await move(a, b.path)
    assert.equal(r1.status, 409)
    assert.equal((await r1.json()).code, 'already_exists')
    assert.equal((await (await req(item(b.path))).json()).title, '乙')
    // 版本过期：409
    assert.equal((await move(a, '项目/甲.json', 0)).status, 409)

    const r2 = await move(a, '项目/甲.json')
    assert.equal(r2.status, 200)
    const moved = await r2.json() as Character
    assert.equal(moved.path, '项目/甲.json')
    assert.equal(moved.version, a.version)
    assert.equal((await req(item(a.path))).status, 404)
    assert.equal((await (await req(item(moved.path))).json()).title, '甲')

    // 只改大小写
    const c = await create(req, { content: titled('alice') })
    const r3 = await move(c, 'Alice.json')
    assert.equal(r3.status, 200)
    const names = [...Deno.readDirSync(root)].map((e) => e.name)
    assert.ok(names.includes('Alice.json') && !names.includes('alice.json'))

    // 目标文件夹不存在：404
    assert.equal((await move(b, '没有/乙.json')).status, 404)
  })
})

Deno.test('saving a character that was moved away outside the app does not recreate it', async () => {
  await withApp(async (req, root) => {
    const a = await create(req, { content: titled('甲') })
    await Deno.mkdir(`${root}/别处`)
    await Deno.rename(`${root}/${a.path}`, `${root}/别处/${a.path}`)
    const r = await req(
      item(a.path),
      json({ expectedVersion: a.version, content: contentOf(a) }, 'PUT'),
    )
    assert.equal(r.status, 404)
    assert.ok(![...Deno.readDirSync(root)].some((e) => e.name === a.path))
    // 用户选择「保存到原位置」：按确切路径新建
    const again = await create(req, { path: a.path, content: contentOf(a) })
    assert.equal(again.path, a.path)
    assert.equal(again.version, 1)
    // 搬走的那份在新位置照常可用
    assert.equal((await req(item(`别处/${a.path}`))).status, 200)
  })
})

Deno.test('folder listing picks up outside changes and ignores hidden entries and foreign JSON', async () => {
  await withApp(async (req, root) => {
    const a = await create(req, { content: titled('甲') })
    assert.equal((await listing(req)).characters[0].title, '甲')

    // 外部改写同一个文件（内容长度变化）→ 再次列出时重读
    const disk = JSON.parse(await Deno.readTextFile(`${root}/${a.path}`))
    disk.title = '外部改过的名字'
    await Deno.writeTextFile(`${root}/${a.path}`, JSON.stringify(disk))
    assert.equal((await listing(req)).characters[0].title, '外部改过的名字')

    // 旧格式（带 uuid id、文件名就是 id）的人物照常列出和打开；保存后去掉 id
    const old = {
      ...disk,
      id: '2e181be7-cc21-481f-a703-1dee5be47cdc',
      title: '旧人物',
    }
    const oldPath = `${old.id}.json`
    await Deno.writeTextFile(`${root}/${oldPath}`, JSON.stringify(old))
    await Deno.mkdir(`${root}/.备份`)
    await Deno.writeTextFile(`${root}/.备份/x.json`, JSON.stringify(old))
    await Deno.writeTextFile(`${root}/外部.json`, '{"hello":1}')
    await Deno.writeTextFile(
      `${root}/存档.json`,
      JSON.stringify({ format: 'tagloom.project', formatVersion: 2 }),
    )
    const top = await listing(req)
    assert.deepEqual(top.folders, [])
    assert.deepEqual(
      top.characters.map((c: { title: string }) => c.title).sort(),
      ['外部改过的名字', '旧人物'].sort(),
    )
    assert.equal(top.otherFiles, 2)
    const opened = await (await req(item(oldPath))).json() as Character
    assert.equal(opened.path, oldPath)
    assert.ok(!('id' in opened))
    await req(
      item(oldPath),
      json(
        { expectedVersion: opened.version, content: contentOf(opened) },
        'PUT',
      ),
    )
    assert.ok(
      !('id' in JSON.parse(await Deno.readTextFile(`${root}/${oldPath}`))),
    )
    // 不是人物的 JSON 打不开（422），不会被当成人物改写
    assert.equal((await req(item('外部.json'))).status, 422)

    // 删除后从列表消失
    await Deno.remove(`${root}/${a.path}`)
    assert.equal((await listing(req)).characters.length, 1)
  })
})

Deno.test('global search reads folders that were never opened', async () => {
  await withApp(async (req, root) => {
    await Deno.mkdir(`${root}/A/B/C`, { recursive: true })
    const deep = {
      ...emptyContent(),
      title: '深处的人',
      version: 1,
      createdAt: 1,
      updatedAt: 5,
      userVersion: 1,
      agentChanges: [],
    }
    await Deno.writeTextFile(`${root}/A/B/C/deep.json`, JSON.stringify(deep))
    await create(req, { content: titled('表层') })
    const all = await (await req('/characters/search')).json()
    assert.equal(all.length, 2)
    const hit = await (await req(`/characters/search?${q({ q: '深处' })}`))
      .json()
    assert.deepEqual(hit.map((c: { path: string }) => c.path), [
      'A/B/C/deep.json',
    ])
    // 按路径也能搜到
    assert.equal(
      (await (await req(`/characters/search?${q({ q: 'a/b' })}`)).json())
        .length,
      1,
    )
    // AI 列表同样是全局的
    assert.equal((await (await req('/agent/characters')).json()).length, 2)
  })
})

Deno.test('folders can be renamed, moved and removed only when empty', async () => {
  await withApp(async (req, root) => {
    for (const path of ['旧名', '旧名/子', '目标']) {
      await req('/folders', json({ path }))
    }
    const a = await create(req, { folder: '旧名/子', content: titled('甲') })
    const moveFolder = (path: string, to: string) =>
      req('/folders/move', json({ path, to }))

    assert.equal((await moveFolder('旧名', '旧名/子/里面')).status, 422)
    assert.equal((await moveFolder('旧名', '目标')).status, 409)
    const r = await moveFolder('旧名', '目标/新名')
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { name: '新名', path: '目标/新名' })
    assert.equal((await req(item(a.path))).status, 404)
    assert.equal(
      (await (await req(item('目标/新名/子/甲.json'))).json()).title,
      '甲',
    )
    // 只改大小写
    await req('/folders', json({ path: 'abc' }))
    assert.equal((await moveFolder('abc', 'ABC')).status, 200)
    assert.ok([...Deno.readDirSync(root)].some((e) => e.name === 'ABC'))

    const remove = (path: string) =>
      req(`/folders?${q({ path })}`, { method: 'DELETE' })
    assert.equal((await remove('目标/新名/子')).status, 422)
    await Deno.writeTextFile(`${root}/ABC/note.txt`, 'x')
    // 里面只有非 JSON 文件也不算空
    assert.equal((await remove('ABC')).status, 422)
    await Deno.remove(`${root}/ABC/note.txt`)
    assert.equal((await remove('ABC')).status, 200)
    assert.equal((await remove('ABC')).status, 404)
    assert.equal((await remove('')).status, 422)
  })
})

Deno.test('older files with ISO timestamps are still listed and opened', async () => {
  await withApp(async (req, root) => {
    const old = {
      ...emptyContent(),
      title: 'ISO 时间',
      id: 'x',
      version: 1,
      createdAt: '2026-10-13T01:58:38.469Z',
      updatedAt: '2026-10-13T01:58:38.469Z',
      userVersion: 1,
      agentChanges: [],
    }
    await Deno.mkdir(root, { recursive: true })
    await Deno.writeTextFile(`${root}/old.json`, JSON.stringify(old))
    const top = await listing(req)
    assert.equal(top.characters[0].updatedAt, Date.parse(old.updatedAt))
    const opened = await (await req(item('old.json'))).json() as Character
    assert.equal(opened.createdAt, Date.parse(old.createdAt))
  })
})
