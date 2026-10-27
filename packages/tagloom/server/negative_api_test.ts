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
  const dir = await Deno.makeTempDir({ prefix: 'tagloom_negative_' })
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
const item = (path: string) => `?path=${encodeURIComponent(path)}`

Deno.test('negative prompt is saved as written and exported as a cleaned negative prompt', async () => {
  await withApp(async (req) => {
    const created = await (await req('/characters', json({})))
      .json() as Character
    assert.equal(created.negativePrompt, '')
    const emptyOutput = await (await req(
      `/characters/item/export/output${item(created.path)}`,
    )).json()
    assert.equal(emptyOutput.character.negativePrompt, '')
    assert.ok(
      !(await (await req(
        `/characters/item/export/output${item(created.path)}&format=text`,
      )).text()).includes('Negative:'),
    )

    const negativePrompt = ' , lowres, (bad hands:1.2),\n多余的手指 ,  '
    const saved = await (await req(
      `/characters/item${item(created.path)}`,
      json({
        expectedVersion: created.version,
        content: { ...contentOf(created), negativePrompt },
      }, 'PUT'),
    )).json() as Character
    // 存的是原文
    assert.equal(saved.negativePrompt, negativePrompt)
    assert.equal(
      (await (await req(`/characters/item${item(created.path)}`)).json())
        .negativePrompt,
      negativePrompt,
    )

    // 成品只去掉首尾的空白和逗号
    const cleaned = 'lowres, (bad hands:1.2),\n多余的手指'
    const output = await (await req(
      `/characters/item/export/output${item(created.path)}`,
    )).json()
    assert.equal(output.character.negativePrompt, cleaned)
    // 不混进正向 Prompt
    for (const combo of output.character.combos) {
      assert.ok(!combo.fullPrompt.includes('lowres'))
    }
    const text = await (await req(
      `/characters/item/export/output${item(created.path)}&format=text`,
    )).text()
    assert.ok(text.includes(`Negative: ${cleaned}\n`))

    // 人物存档往返
    const archive = await (await req(
      `/characters/item/export/project${item(created.path)}`,
    )).json()
    assert.equal(archive.character.negativePrompt, negativePrompt)
    const imported = await (await req('/characters/import', json({ archive })))
      .json() as Character
    assert.equal(imported.negativePrompt, negativePrompt)
  })
})

Deno.test('old character files and archives default negative prompt to empty without rewriting on read', async () => {
  await withApp(async (req, root) => {
    const created = await (await req('/characters', json({})))
      .json() as Character
    const { negativePrompt: _n, ...old } = created
    const original = JSON.stringify(old)
    await Deno.writeTextFile(`${root}/${created.path}`, original)
    const opened = await (await req(`/characters/item${item(created.path)}`))
      .json() as Character
    assert.equal(opened.negativePrompt, '')
    assert.equal(await Deno.readTextFile(`${root}/${created.path}`), original)

    const imported = await req(
      '/characters/import',
      json({
        archive: {
          format: 'tagloom.project',
          formatVersion: 2,
          character: old,
        },
      }),
    )
    assert.equal(imported.status, 201)
    assert.equal((await imported.json()).negativePrompt, '')

    for (const negativePrompt of [null, 42, ['x'], 'x'.repeat(200_001)]) {
      assert.equal(
        (await req(
          `/characters/item${item(created.path)}`,
          json({
            expectedVersion: opened.version,
            content: { ...contentOf(opened), negativePrompt },
          }, 'PUT'),
        )).status,
        422,
      )
    }
  })
})
