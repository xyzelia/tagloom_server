// 场景接口：新建命名、保存带版本号、校验、复制、移动 / 改名不覆盖、全文搜索、导出、文件夹、与人物目录互不混入。
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { closeTagloomRuntime, tagloomPlugin } from './mod.ts'
import {
  addTextItem,
  buildSlotSnapshot,
  type Character,
  createCustomTag,
  emptySceneContent,
  emptySlot,
  pickCustomTag,
  type Scene,
  SCENE_FORMAT,
  type SceneContent,
  sceneContentOf,
} from '../share/mod.ts'

type Req = (path: string, init?: RequestInit) => Promise<Response>

async function withApp(fn: (req: Req, dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: 'tagloom_scenes_' })
  closeTagloomRuntime()
  const plugin = tagloomPlugin({ dataDir: dir, catalogPath: 'missing.sqlite' })
  const app = new Hono().route('/api/tagloom', plugin.api)
  const req: Req = (path, init) =>
    Promise.resolve(app.request(`/api/tagloom${path}`, init))
  try {
    await fn(req, dir)
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
const item = (path: string) => `/scenes/item?${q({ path })}`

async function create(req: Req, body: Record<string, unknown>): Promise<Scene> {
  const r = await req('/scenes', json(body))
  assert.equal(r.status, 201)
  return await r.json()
}

async function save(req: Req, s: Scene, content = sceneContentOf(s)) {
  return await req(
    item(s.path),
    json({ expectedVersion: s.version, content }, 'PUT'),
  )
}

Deno.test('scenes are created by title, saved with versions and written with the marker', async () => {
  await withApp(async (req, dir) => {
    const empty = await create(req, {})
    assert.equal(empty.path, '未命名场景.json')
    const a = await create(req, { content: emptySceneContent('街道') })
    const b = await create(req, { content: emptySceneContent('街道') })
    assert.equal(a.path, '街道.json')
    assert.equal(b.path, '街道 (2).json')
    assert.equal('format' in a, false)

    const disk = JSON.parse(await Deno.readTextFile(`${dir}/scenes/街道.json`))
    assert.deepEqual(Object.keys(disk).slice(0, 2), ['format', 'formatVersion'])
    assert.equal(disk.format, SCENE_FORMAT)
    assert.equal('path' in disk, false)

    const content = sceneContentOf(a)
    content.content = addTextItem(content.content, 'street, sunset')
    const r = await save(req, a, content)
    assert.equal(r.status, 200)
    const saved = await r.json() as Scene
    assert.equal(saved.version, 2)
    assert.equal(saved.content.items[0].text, 'street, sunset')

    // 旧版本再保存 → 冲突
    const stale = await save(req, a)
    assert.equal(stale.status, 409)
    assert.equal((await stale.json()).code, 'version_conflict')

    const listing = await (await req('/scenes')).json()
    assert.deepEqual(
      listing.scenes.map((s: { title: string }) => s.title),
      // 按拼音排序：街（jiē）在未（wèi）前
      ['街道', '街道', '未命名场景'],
    )
  })
})

Deno.test('scene content is validated: no fields, no facts, field-less custom tags, slot limit', async () => {
  await withApp(async (req) => {
    const s = await create(req, {})
    const base = sceneContentOf(s)

    const withField = structuredClone(base)
    withField.content = addTextItem(withField.content, 'x')
    ;(withField.content.items[0] as { field: string | null }).field = 'hair'
    assert.equal((await save(req, s, withField)).status, 422)

    const withState = structuredClone(base)
    withState.content.fieldStates = { hair: 'open' }
    assert.equal((await save(req, s, withState)).status, 422)

    const withTagField = structuredClone(base)
    withTagField.customTags = [
      createCustomTag({ text: 'x', fields: ['hair'] }, { origin: 'user' }),
    ]
    assert.equal((await save(req, s, withTagField)).status, 422)

    const tooMany = structuredClone(base)
    tooMany.slots = Array.from({ length: 7 }, () => emptySlot())
    assert.equal((await save(req, s, tooMany)).status, 422)

    const badPos = structuredClone(base)
    badPos.slots = [{ ...emptySlot(), position: { x: 1.5, y: 0 } }]
    assert.equal((await save(req, s, badPos)).status, 422)

    // 合法：场景自创标签 + 6 个槽位
    const ok = structuredClone(base)
    const tag = createCustomTag({ text: 'rim light' }, { origin: 'user' })
    ok.customTags = [tag]
    ok.content = pickCustomTag(ok.content, null, tag)
    ok.slots = Array.from({ length: 6 }, () => emptySlot())
    assert.equal((await save(req, s, ok)).status, 200)
  })
})

Deno.test('slots keep a character snapshot that does not follow later character edits', async () => {
  await withApp(async (req) => {
    const r = await req('/characters', json({ folder: '' }))
    const c = await r.json() as Character
    const snap = buildSlotSnapshot(c, c.path, c.combos[0].id, null, 1)!
    const s = await create(req, {})
    const content = sceneContentOf(s)
    content.slots = [{ ...emptySlot('主角'), snapshot: snap }]
    assert.equal((await save(req, s, content)).status, 200)

    // 删除人物后场景照常读取
    const del = await req(
      `/characters/item?${q({ path: c.path, expectedVersion: '1' })}`,
      { method: 'DELETE' },
    )
    assert.equal(del.status, 200)
    const reread = await (await req(item(s.path))).json() as Scene
    assert.equal(reread.slots[0].snapshot?.characterPath, c.path)
  })
})

Deno.test('copy, move and delete scenes without overwriting', async () => {
  await withApp(async (req) => {
    await req('/scenes/folders', json({ path: '夜' }))
    const s = await create(req, {
      content: emptySceneContent('街道'),
      folder: '夜',
    })
    assert.equal(s.path, '夜/街道.json')

    const copy = await req(`/scenes/item/copy?${q({ path: s.path })}`, json({}))
    assert.equal(copy.status, 201)
    const copied = await copy.json() as Scene
    assert.equal(copied.path, '夜/街道 副本.json')
    assert.equal(copied.title, '街道 副本')
    assert.equal(copied.version, 1)

    const blocked = await req(
      `/scenes/item/move?${q({ path: s.path })}`,
      json({ expectedVersion: 1, to: '夜/街道 副本.json' }),
    )
    assert.equal(blocked.status, 409)
    assert.equal((await blocked.json()).code, 'already_exists')

    const moved = await req(
      `/scenes/item/move?${q({ path: s.path })}`,
      json({ expectedVersion: 1, to: '街道.json' }),
    )
    assert.equal(moved.status, 200)
    assert.equal((await moved.json() as Scene).path, '街道.json')
    assert.equal((await req(item(s.path))).status, 404)

    // 文件夹不空不能删
    const notEmpty = await req(`/scenes/folders?${q({ path: '夜' })}`, {
      method: 'DELETE',
    })
    assert.equal(notEmpty.status, 422)

    const wrongVersion = await req(
      `/scenes/item?${q({ path: '街道.json', expectedVersion: '9' })}`,
      { method: 'DELETE' },
    )
    assert.equal(wrongVersion.status, 409)
    const del = await req(
      `/scenes/item?${q({ path: '街道.json', expectedVersion: '1' })}`,
      { method: 'DELETE' },
    )
    assert.equal(del.status, 200)
    assert.equal((await req(item('街道.json'))).status, 404)

    const renamed = await req(
      '/scenes/folders/move',
      json({ path: '夜', to: '深夜' }),
    )
    assert.equal(renamed.status, 200)
    assert.equal((await req(item('深夜/街道 副本.json'))).status, 200)
  })
})

Deno.test('scene search matches item text and snapshot text, across folders', async () => {
  await withApp(async (req) => {
    await req('/scenes/folders', json({ path: '子' }))
    const a = await create(req, { folder: '子' })
    const content = sceneContentOf(a)
    content.content = addTextItem(content.content, 'Cherry Blossoms')
    content.slots = [{
      ...emptySlot(),
      snapshot: {
        characterPath: 'x.json',
        title: '艾莉丝',
        comboId: 'c',
        comboName: '日常',
        stateId: null,
        stateName: '',
        takenAt: 1,
        subject: '1girl',
        base: 'silver hair',
        costume: '',
        expression: '',
        action: '',
        negative: '',
        use: {
          subject: true,
          base: true,
          costume: true,
          expression: true,
          action: true,
          negative: true,
        },
      },
    }]
    assert.equal((await save(req, a, content)).status, 200)
    await create(req, { content: emptySceneContent('其他') })

    const search = async (text: string) =>
      (await (await req(`/scenes/search?${q({ q: text })}`)).json())
        .map((s: { path: string }) => s.path)
    assert.deepEqual(await search('cherry'), [a.path])
    assert.deepEqual(await search('SILVER'), [a.path])
    assert.deepEqual(await search('艾莉丝'), [a.path])
    assert.deepEqual(await search('nothing'), [])
    assert.equal((await search('')).length, 2)
  })
})

Deno.test('scene export downloads output JSON or text', async () => {
  await withApp(async (req) => {
    const s = await create(req, { content: emptySceneContent('街道') })
    const content = sceneContentOf(s)
    content.content = addTextItem(content.content, 'street')
    content.slots = [{
      ...emptySlot('甲'),
      extra: addTextItem(emptySlot().extra, '1boy'),
    }]
    await save(req, s, content)
    const out = await req(
      `/scenes/item/export/output?${q({ path: s.path })}`,
    )
    assert.equal(out.status, 200)
    assert.match(out.headers.get('content-disposition') ?? '', /scene\.json/)
    const body = await out.json()
    assert.equal(body.prompt, 'street')
    assert.deepEqual(body.characters, [
      { label: '甲', prompt: '1boy', negativePrompt: '', x: null, y: null },
    ])
    const text = await req(
      `/scenes/item/export/output?${q({ path: s.path, format: 'text' })}`,
    )
    assert.match(await text.text(), /^# 街道\n/)
  })
})

Deno.test('scene params are optional, saved, cleared and validated', async () => {
  await withApp(async (req) => {
    let s = await create(req, { content: emptySceneContent('参数') })
    assert.equal(s.params, undefined)
    const content = sceneContentOf(s)
    content.params = { width: 832, height: 1216, seed: 7, model: ' ' }
    let r = await save(req, s, content)
    assert.equal(r.status, 200)
    s = await r.json() as Scene
    // 空字符串项不存
    assert.deepEqual(s.params, { width: 832, height: 1216, seed: 7 })
    const out = await (await req(
      `/scenes/item/export/output?${q({ path: s.path })}`,
    )).json()
    assert.deepEqual(out.params, { width: 832, height: 1216, seed: 7 })

    // 不带 params 保存 = 清空
    const { params: _p, ...cleared } = sceneContentOf(s)
    r = await save(req, s, cleared)
    s = await r.json() as Scene
    assert.equal(s.params, undefined)
    const got = await (await req(item(s.path))).json() as Scene
    assert.equal(got.params, undefined)

    // 取值超出范围、未知字段 → 拒绝
    for (const params of [{ seed: -1 }, { width: 1.5 }, { foo: 1 }]) {
      const bad = await save(req, s, { ...cleared, params } as SceneContent)
      assert.equal(bad.status, 422)
      await bad.body?.cancel()
    }
  })
})

Deno.test('scenes and characters stay in their own folders', async () => {
  await withApp(async (req, dir) => {
    await create(req, { content: emptySceneContent('场景A') })
    await req('/characters', json({ folder: '' }))
    const chars = await (await req('/characters')).json()
    assert.equal(chars.characters.length, 1)
    assert.equal(chars.otherFiles, 0)
    const scenes = await (await req('/scenes')).json()
    assert.equal(scenes.scenes.length, 1)
    assert.equal(scenes.otherFiles, 0)

    // 人物文件放进 scenes/ 不当作场景
    await Deno.copyFile(
      `${dir}/characters/${chars.characters[0].path}`,
      `${dir}/scenes/人物.json`,
    )
    const again = await (await req('/scenes')).json()
    assert.equal(again.scenes.length, 1)
    assert.equal(again.otherFiles, 1)
    const r = await req(item('人物.json'))
    assert.equal(r.status, 422)
    assert.match((await r.json()).message, /不是场景文件/)

    // 路径越界
    assert.equal((await req(item('../characters/x.json'))).status, 422)
  })
})
