// 文件格式标记：人物文件写入 tagloom.character v2；旧文件（无标记）照常读取；其他格式不当作人物。
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { closeTagloomRuntime, tagloomPlugin } from './mod.ts'
import {
  type Character,
  CHARACTER_FORMAT,
  CHARACTER_FORMAT_VERSION,
  detectFormat,
  emptyContent,
  PROJECT_FORMAT,
  SCENE_FORMAT,
} from '../share/mod.ts'

type Req = (path: string, init?: RequestInit) => Promise<Response>

async function withApp(fn: (req: Req, root: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: 'tagloom_format_' })
  closeTagloomRuntime()
  const plugin = tagloomPlugin({ dataDir: dir, catalogPath: 'missing.sqlite' })
  const app = new Hono().route('/api/tagloom', plugin.api)
  const req: Req = (path, init) =>
    Promise.resolve(app.request(`/api/tagloom${path}`, init))
  try {
    await Deno.mkdir(`${dir}/characters`, { recursive: true })
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
const item = (path: string) => `/characters/item?${q({ path })}`
const stored = (title: string) => ({
  ...emptyContent(),
  title,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  userVersion: 1,
  agentChanges: [],
})

Deno.test('detectFormat reads only the marker and rejects unknown versions', () => {
  assert.equal(detectFormat({}), 'character')
  assert.equal(
    detectFormat({ format: CHARACTER_FORMAT, formatVersion: 2 }),
    'character',
  )
  assert.equal(
    detectFormat({ format: CHARACTER_FORMAT, formatVersion: 3 }),
    'unknown',
  )
  assert.equal(detectFormat({ format: CHARACTER_FORMAT }), 'unknown')
  assert.equal(
    detectFormat({ format: SCENE_FORMAT, formatVersion: 1 }),
    'scene',
  )
  assert.equal(
    detectFormat({ format: PROJECT_FORMAT, formatVersion: 2 }),
    'project',
  )
  assert.equal(detectFormat({ format: 'other', formatVersion: 1 }), 'unknown')
  assert.equal(detectFormat([]), 'unknown')
  assert.equal(detectFormat(null), 'unknown')
})

Deno.test('saved characters carry the marker; old unmarked files still load', async () => {
  await withApp(async (req, root) => {
    // 旧文件：没有标记，读取不改写磁盘
    const oldText = JSON.stringify(stored('旧人物'))
    await Deno.writeTextFile(`${root}/old.json`, oldText)
    const old = await (await req(item('old.json'))).json() as Character
    assert.equal(old.title, '旧人物')
    assert.equal('format' in old, false)
    assert.equal(await Deno.readTextFile(`${root}/old.json`), oldText)

    // 保存后补上标记，且标记在最前面
    const r = await req(
      item('old.json'),
      json({ expectedVersion: 1, content: emptyContent() }, 'PUT'),
    )
    assert.equal(r.status, 200)
    const disk = JSON.parse(await Deno.readTextFile(`${root}/old.json`))
    assert.deepEqual(Object.keys(disk).slice(0, 2), ['format', 'formatVersion'])
    assert.equal(disk.format, CHARACTER_FORMAT)
    assert.equal(disk.formatVersion, CHARACTER_FORMAT_VERSION)
    assert.equal('path' in disk, false)

    // 新建同样带标记；接口返回的人物不带标记
    const created = await (await req('/characters', json({ folder: '' })))
      .json() as Character
    assert.equal('format' in created, false)
    const createdDisk = JSON.parse(
      await Deno.readTextFile(`${root}/${created.path}`),
    )
    assert.equal(createdDisk.format, CHARACTER_FORMAT)
    const reread = await (await req(item(created.path))).json() as Character
    assert.equal(reread.version, 1)
  })
})

Deno.test('scene files and unknown versions in characters/ are not characters', async () => {
  await withApp(async (req, root) => {
    await Deno.writeTextFile(
      `${root}/scene.json`,
      JSON.stringify({
        ...stored('场景'),
        format: SCENE_FORMAT,
        formatVersion: 1,
      }),
    )
    await Deno.writeTextFile(
      `${root}/future.json`,
      JSON.stringify({
        ...stored('未来版本'),
        format: CHARACTER_FORMAT,
        formatVersion: 3,
      }),
    )
    const listing = await (await req('/characters')).json()
    assert.equal(listing.characters.length, 0)
    assert.equal(listing.otherFiles, 2)
    assert.equal((await req(item('scene.json'))).status, 422)

    const preview = await (await req(
      `/files/preview?${q({ path: 'scene.json' })}`,
    )).json()
    assert.equal(preview.kind, 'json')
    assert.equal(
      (await req('/files/import', json({ path: 'scene.json' }))).status,
      422,
    )
  })
})

Deno.test('marked character files can be previewed and imported from the file browser', async () => {
  await withApp(async (req, root) => {
    await Deno.writeTextFile(
      `${root}/marked.json`,
      JSON.stringify({
        format: CHARACTER_FORMAT,
        formatVersion: CHARACTER_FORMAT_VERSION,
        ...stored('带标记'),
      }),
    )
    const preview = await (await req(
      `/files/preview?${q({ path: 'marked.json' })}`,
    )).json()
    assert.equal(preview.kind, 'character')
    assert.equal(preview.summary.title, '带标记')
    const r = await req('/files/import', json({ path: 'marked.json' }))
    assert.equal(r.status, 201)
    assert.equal((await r.json() as Character).title, '带标记')
  })
})

Deno.test('project archives import with or without a marker on the inner character', async () => {
  await withApp(async (req) => {
    for (const marked of [false, true]) {
      const character = {
        ...(marked
          ? {
            format: CHARACTER_FORMAT,
            formatVersion: CHARACTER_FORMAT_VERSION,
          }
          : {}),
        ...emptyContent(),
        title: `存档 ${marked}`,
        createdAt: 1,
        updatedAt: 1,
        version: 1,
      }
      const r = await req(
        '/characters/import',
        json({
          archive: {
            format: PROJECT_FORMAT,
            formatVersion: 2,
            exportedAt: 1,
            character,
          },
        }),
      )
      assert.equal(r.status, 201)
      assert.equal((await r.json() as Character).title, `存档 ${marked}`)
    }
    // 导出的存档内层不带标记
    const list = await (await req('/characters')).json()
    const exported = await (await req(
      `/characters/item/export/project?${q({ path: list.characters[0].path })}`,
    )).json()
    assert.equal('format' in exported.character, false)
  })
})
