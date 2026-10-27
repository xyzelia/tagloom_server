import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { closeTagloomRuntime, tagloomPlugin } from './mod.ts'
import {
  addTextItem,
  type Character,
  contentOf,
  emptyState,
} from '../share/mod.ts'

async function withApp(
  fn: (
    req: (path: string, init?: RequestInit) => Promise<Response>,
    root: string,
  ) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: 'tagloom_states_' })
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

Deno.test('states and seed save, export, import and disk-preview consistently', async () => {
  await withApp(async (req, root) => {
    const created = await (await req('/characters', json({})))
      .json() as Character
    const content = contentOf(created)
    const state = emptyState('笑')
    state.expression = addTextItem(state.expression, 'smile')
    state.overrides['costume.top'] = {
      mode: 'replace',
      content: { items: [], facts: [], fieldStates: {} },
    }
    state.seed = 0
    content.seed = 42
    content.combos[0].states = [state]
    const saved = await req(
      `/characters/item?path=${encodeURIComponent(created.path)}`,
      json({ expectedVersion: created.version, content }, 'PUT'),
    )
    assert.equal(saved.status, 200)
    const got = await (await req(
      `/characters/item?path=${encodeURIComponent(created.path)}`,
    ))
      .json() as Character
    assert.equal(got.seed, 42)
    assert.equal(got.combos[0].states[0].seed, 0)

    const out = await (await req(
      `/characters/item/export/output?path=${encodeURIComponent(created.path)}`,
    ))
      .json()
    assert.equal(out.character.seed, 42)
    assert.equal(out.character.combos[0].states[0].seed, 0)
    assert.equal(out.character.combos[0].states[0].fullPrompt, 'smile')
    const text = await (await req(
      `/characters/item/export/output?path=${
        encodeURIComponent(created.path)
      }&format=text`,
    ))
      .text()
    assert.ok(text.includes('Seed: 42') && text.includes('Prompt: smile'))

    const archive = await (await req(
      `/characters/item/export/project?path=${
        encodeURIComponent(created.path)
      }`,
    )).json()
    const imported = await (await req('/characters/import', json({ archive })))
      .json() as Character
    assert.deepEqual(contentOf(imported), contentOf(got))

    const preview = await (await req(
      `/files/preview?path=${encodeURIComponent(created.path)}`,
    ))
      .json()
    assert.equal(preview.kind, 'character')
    const disk =
      await (await req('/files/import', json({ path: created.path })))
        .json() as Character
    assert.deepEqual(contentOf(disk).combos[0].states, content.combos[0].states)
    assert.equal(disk.seed, 42)
    void root
  })
})

Deno.test('invalid seed, targets and modes are rejected with 422', async () => {
  await withApp(async (req) => {
    const created = await (await req('/characters', json({})))
      .json() as Character
    const put = (mutate: (c: ReturnType<typeof contentOf>) => void) => {
      const content = structuredClone(contentOf(created))
      content.combos[0].states = [emptyState('s')]
      mutate(content)
      return req(
        `/characters/item?path=${encodeURIComponent(created.path)}`,
        json({ expectedVersion: created.version, content }, 'PUT'),
      )
    }
    assert.equal((await put((c) => (c.seed = 2 ** 32))).status, 422)
    assert.equal((await put((c) => (c.seed = -1))).status, 422)
    assert.equal(
      (await put((c) => // deno-lint-ignore no-explicit-any
      ((c.combos[0].states[0].overrides as any)['costume.bogus'] = {
        mode: 'append',
        content: { items: [], facts: [], fieldStates: {} },
      }))).status,
      422,
    )
    assert.equal(
      (await put((c) => // deno-lint-ignore no-explicit-any
      ((c.combos[0].states[0].overrides as any)['base.hair'] = {
        mode: 'merge',
        content: { items: [], facts: [], fieldStates: {} },
      }))).status,
      422,
    )
    assert.equal((await put(() => {})).status, 200)
  })
})

Deno.test('legacy character files without states or seed read with defaults and are not rewritten', async () => {
  await withApp(async (req, root) => {
    const created = await (await req('/characters', json({})))
      .json() as Character
    const old = structuredClone(created) as unknown as Record<string, unknown>
    delete old.seed
    for (const combo of old.combos as Record<string, unknown>[]) {
      delete combo.states
    }
    const original = JSON.stringify(old)
    await Deno.writeTextFile(`${root}/${created.path}`, original)
    const opened = await (await req(
      `/characters/item?path=${encodeURIComponent(created.path)}`,
    ))
      .json() as Character
    assert.equal(opened.seed, undefined)
    for (const combo of opened.combos) assert.deepEqual(combo.states, [])
    assert.equal((await (await req('/characters/search')).json()).length, 1)
    const preview = await (await req(
      `/files/preview?path=${encodeURIComponent(created.path)}`,
    ))
      .json()
    assert.equal(preview.kind, 'character')
    const archive = {
      format: 'tagloom.project',
      formatVersion: 2,
      character: old,
    }
    const imported = await req('/characters/import', json({ archive }))
    assert.equal(imported.status, 201)
    assert.deepEqual(
      (await imported.json()).combos.map((c: { states: unknown[] }) =>
        c.states
      ),
      opened.combos.map(() => []),
    )
    assert.equal(
      await Deno.readTextFile(`${root}/${created.path}`),
      original,
    )
  })
})
