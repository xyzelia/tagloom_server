import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { closeTagloomRuntime, tagloomPlugin } from './mod.ts'
import { type Character, contentOf } from '../share/mod.ts'

async function withApp(
  fn: (
    req: (path: string, init?: RequestInit) => Promise<Response>,
    root: string,
  ) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: 'tagloom_style_' })
  closeTagloomRuntime()
  const plugin = tagloomPlugin({ dataDir: dir, catalogPath: 'missing.sqlite' })
  const app = new Hono().route('/api/tagloom', plugin.api)
  const req = (path: string, init?: RequestInit) =>
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

Deno.test('handwritten style follows a character through save, reload and project import/export without changing prompts', async () => {
  await withApp(async (req, root) => {
    const created = await (await req('/characters', json({})))
      .json() as Character
    assert.equal(created.stylePrompt, '')
    const before = await (await req(
      `/characters/item/export/output?path=${encodeURIComponent(created.path)}`,
    ))
      .json()
    const beforeText = await (await req(
      `/characters/item/export/output?path=${
        encodeURIComponent(created.path)
      }&format=text`,
    ))
      .text()
    const stylePrompt =
      '  artist:手写画师, (watercolor:1.2)\n自定义画风串，不自动处理  \n'
    const response = await req(
      `/characters/item?path=${encodeURIComponent(created.path)}`,
      json({
        expectedVersion: created.version,
        content: { ...contentOf(created), stylePrompt },
      }, 'PUT'),
    )
    assert.equal(response.status, 200)
    const saved = await response.json() as Character
    assert.equal(saved.stylePrompt, stylePrompt)
    assert.equal(
      (await (await req(
        `/characters/item?path=${encodeURIComponent(created.path)}`,
      )).json()).stylePrompt,
      stylePrompt,
    )
    assert.equal(
      JSON.parse(await Deno.readTextFile(`${root}/${created.path}`))
        .stylePrompt,
      stylePrompt,
    )
    const archive = await (await req(
      `/characters/item/export/project?path=${
        encodeURIComponent(created.path)
      }`,
    )).json()
    assert.equal(archive.character.stylePrompt, stylePrompt)
    assert.equal(archive.formatVersion, 2)
    const imported = await (await req('/characters/import', json({ archive })))
      .json()
    assert.notEqual(imported.path, created.path)
    assert.equal(imported.stylePrompt, stylePrompt)
    // 新建另一人物不会共享或继承前一个人物的画风串。
    const other = await (await req('/characters', json({}))).json()
    assert.equal(other.stylePrompt, '')
    const after = await (await req(
      `/characters/item/export/output?path=${encodeURIComponent(created.path)}`,
    ))
      .json()
    assert.deepEqual(after.character, before.character)
    assert.equal(
      await (await req(
        `/characters/item/export/output?path=${
          encodeURIComponent(created.path)
        }&format=text`,
      ))
        .text(),
      beforeText,
    )
    const preview = await (await req(
      `/files/preview?path=${encodeURIComponent(created.path)}`,
    ))
      .json()
    assert.equal(preview.summary.stylePrompt, stylePrompt)
    const diskImported =
      await (await req('/files/import', json({ path: created.path })))
        .json()
    assert.equal(diskImported.stylePrompt, stylePrompt)
    // 支持手动清空。
    const cleared = await req(
      `/characters/item?path=${encodeURIComponent(created.path)}`,
      json({
        expectedVersion: saved.version,
        content: { ...contentOf(saved), stylePrompt: '' },
      }, 'PUT'),
    )
    assert.equal((await cleared.json()).stylePrompt, '')
  })
})

Deno.test('old character files and v2 archives default style to empty without rewriting on read', async () => {
  await withApp(async (req, root) => {
    const created = await (await req('/characters', json({})))
      .json() as Character
    const { stylePrompt: _style, ...old } = created
    const original = JSON.stringify(old)
    await Deno.writeTextFile(`${root}/${created.path}`, original)
    const opened = await (await req(
      `/characters/item?path=${encodeURIComponent(created.path)}`,
    ))
      .json() as Character
    assert.equal(opened.stylePrompt, '')
    assert.equal((await (await req('/characters/search')).json()).length, 1)
    const file = await (await req(
      `/files/preview?path=${encodeURIComponent(created.path)}`,
    ))
      .json()
    assert.equal(file.kind, 'character')
    assert.equal(file.summary.stylePrompt, '')
    assert.equal(
      await Deno.readTextFile(`${root}/${created.path}`),
      original,
    )
    const oldArchive = {
      format: 'tagloom.project',
      formatVersion: 2,
      character: old,
    }
    const imported = await req(
      '/characters/import',
      json({ archive: oldArchive }),
    )
    assert.equal(imported.status, 201)
    assert.equal((await imported.json()).stylePrompt, '')
    const saved = await req(
      `/characters/item?path=${encodeURIComponent(created.path)}`,
      json({
        expectedVersion: opened.version,
        content: { ...contentOf(opened), stylePrompt: '新的画风串' },
      }, 'PUT'),
    )
    assert.equal(saved.status, 200)
    assert.equal((await saved.json()).stylePrompt, '新的画风串')
  })
})

Deno.test('style field validation rejects non-text and oversized values without overwriting a saved style', async () => {
  await withApp(async (req) => {
    const created = await (await req('/characters', json({})))
      .json() as Character
    const response = await req(
      `/characters/item?path=${encodeURIComponent(created.path)}`,
      json({
        expectedVersion: created.version,
        content: { ...contentOf(created), stylePrompt: '保留原文' },
      }, 'PUT'),
    )
    const saved = await response.json() as Character
    for (const stylePrompt of [null, 42, ['artist'], {}, 'x'.repeat(200_001)]) {
      assert.equal(
        (await req(
          `/characters/item?path=${encodeURIComponent(saved.path)}`,
          json({
            expectedVersion: saved.version,
            content: { ...contentOf(saved), stylePrompt },
          }, 'PUT'),
        )).status,
        422,
      )
    }
    const current = await (await req(
      `/characters/item?path=${encodeURIComponent(saved.path)}`,
    )).json()
    assert.equal(current.stylePrompt, '保留原文')
    assert.equal(current.version, saved.version)
  })
})
