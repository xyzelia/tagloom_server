// AI agent 接口：来源不可伪造、重复复用、校验跳过、加进分类（勾选）、编辑页拉取合并与保存时合并、真正并发仍冲突。
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { closeTagloomRuntime, tagloomPlugin } from './mod.ts'
import {
  type AgentChange,
  applyAgentChanges,
  assembleCombo,
  type Character,
  contentOf,
  removeItem,
  segmentText,
} from '../share/mod.ts'

async function withApp(
  fn: (
    req: (path: string, init?: RequestInit) => Promise<Response>,
  ) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: 'tagloom_agent_' })
  closeTagloomRuntime()
  const plugin = tagloomPlugin({ dataDir: dir, catalogPath: 'missing.sqlite' })
  const app = new Hono().basePath('/api').route(`/${plugin.name}`, plugin.api)
  const req = (path: string, init?: RequestInit) =>
    Promise.resolve(app.request(`/api/tagloom${path}`, init))
  try {
    await fn(req)
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

type Req = (path: string, init?: RequestInit) => Promise<Response>

async function newCharacter(req: Req): Promise<Character> {
  return await (await req('/characters', json({}))).json()
}

async function userSave(req: Req, c: Character, expectedVersion = c.version) {
  return await req(
    `/characters/item?path=${encodeURIComponent(c.path)}`,
    json({ expectedVersion, content: contentOf(c) }, 'PUT'),
  )
}

const addTags = (req: Req, path: string, body: unknown) =>
  req(
    `/agent/character/custom-tags?path=${encodeURIComponent(path)}`,
    json(body),
  )

Deno.test('agent tags are always recorded as agent-created, with agent name', async () => {
  await withApp(async (req) => {
    const c = await newCharacter(req)
    const r = await addTags(req, c.path, {
      agentName: 'demo-agent',
      // 请求里写 origin: 'user' 也无效：来源由服务端写死
      tags: [{
        text: 'glowing tattoo',
        label: '发光纹身',
        origin: 'user',
        fields: ['recognition_mark'],
      }],
    })
    assert.equal(r.status, 200)
    const res = await r.json()
    assert.equal(res.created.length, 1)
    assert.equal(res.version, 2)
    const saved =
      await (await req(`/characters/item?path=${encodeURIComponent(c.path)}`))
        .json() as Character
    assert.deepEqual(
      saved.customTags.map((t) => [t.text, t.origin, t.agentName, t.fields]),
      [['glowing tattoo', 'agent', 'demo-agent', ['recognition_mark']]],
    )
    // 只加进标签库、没有 addTo：不改变输出
    assert.equal(assembleCombo(saved, saved.combos[0]).full, '')
    assert.equal(saved.userVersion, 1)
  })
})

Deno.test('addTo adds checked items (changes output); duplicates reuse the existing tag', async () => {
  await withApp(async (req) => {
    const c = await newCharacter(req)
    const comboId = c.combos[0].id
    await addTags(req, c.path, {
      agentName: 'a1',
      tags: [{
        text: 'star-shaped ahoge',
        fields: ['hair_extra_structure'],
        addTo: [{ segment: 'base.hair' }],
      }],
    })
    const r = await (await addTags(req, c.path, {
      agentName: 'a2',
      tags: [{
        text: 'Star-Shaped Ahoge',
        addTo: [{ segment: 'base.hair' }, {
          segment: `combo.${comboId}.hair_override`,
        }],
      }],
    })).json()
    assert.equal(r.created.length, 0)
    assert.equal(r.reused.length, 1)
    const saved =
      await (await req(`/characters/item?path=${encodeURIComponent(c.path)}`))
        .json() as Character
    assert.equal(saved.customTags.length, 1)
    // 同一分类不重复添加条目
    assert.equal(saved.base.segments.hair.items.length, 1)
    const item = saved.base.segments.hair.items[0]
    assert.deepEqual(
      [item.included, item.origin, item.agentName, item.field],
      [true, 'agent', 'a1', 'hair_extra_structure'],
    )
    assert.equal(segmentText(saved.base.segments.hair), 'star-shaped ahoge')
    assert.equal(
      segmentText(saved.combos[0].hairOverride.segment),
      'star-shaped ahoge',
    )
  })
})

Deno.test('invalid parts are skipped with reasons; malformed requests are 422', async () => {
  await withApp(async (req) => {
    const c = await newCharacter(req)
    const r = await (await addTags(req, c.path, {
      agentName: 'a',
      tags: [
        { text: 'x', fields: ['no_such_field'] },
        { text: 'y', addTo: [{ segment: 'combo.nope.top' }] },
        { text: 'z', addTo: [{ segment: 'base.eyes', field: 'hair_color' }] },
      ],
    })).json()
    assert.equal(r.skipped.length, 3)
    assert.deepEqual(r.created.map((t: { text: string }) => t.text), ['y', 'z'])
    assert.equal(r.items.length, 0)
    assert.equal(
      (await addTags(req, c.path, { agentName: 'a', tags: [] })).status,
      422,
    )
    assert.equal(
      (await addTags(req, c.path, { tags: [{ text: 'q' }] })).status,
      422,
    )
    assert.equal(
      (await addTags(req, 'nope.json', {
        agentName: 'a',
        tags: [{ text: 'q' }],
      }))
        .status,
      404,
    )
  })
})

Deno.test('agent context lists segments with addresses, fields and current output', async () => {
  await withApp(async (req) => {
    const c = await newCharacter(req)
    const ctx =
      await (await req(`/agent/character?path=${encodeURIComponent(c.path)}`))
        .json()
    const addresses = ctx.segments.map((s: { address: string }) => s.address)
    assert.ok(addresses.includes('base.hair'))
    assert.ok(addresses.includes(`combo.${c.combos[0].id}.top`))
    assert.ok(addresses.includes(`combo.${c.combos[0].id}.hair_override`))
    const hair = ctx.segments.find((s: { address: string }) =>
      s.address === 'base.hair'
    )
    assert.ok(hair.fields.some((f: { key: string }) => f.key === 'hair_color'))
    const list = await (await req('/agent/characters')).json()
    assert.equal(list[0].path, c.path)
  })
})

Deno.test('saving from a stale editor merges agent additions instead of conflicting', async () => {
  await withApp(async (req) => {
    const opened = await newCharacter(req) // 编辑页打开时的版本 1
    await addTags(req, opened.path, {
      agentName: 'a',
      tags: [{ text: 'glowing tattoo', addTo: [{ segment: 'base.other' }] }],
    })
    // 用户在旧版本上改了标题后保存
    const edited = {
      ...opened,
      title: '我的角色',
      stylePrompt: '  手写画风\nartist  ',
    }
    const r = await userSave(req, edited, 1)
    assert.equal(r.status, 200)
    const saved = await r.json()
    assert.deepEqual(saved.agentMerged, { tags: 1, items: 1, skipped: [] })
    assert.equal(saved.title, '我的角色')
    assert.equal(saved.stylePrompt, edited.stylePrompt)
    assert.equal(saved.customTags[0].text, 'glowing tattoo')
    assert.equal(segmentText(saved.base.segments.other), 'glowing tattoo')
    assert.equal(saved.userVersion, saved.version)
    assert.deepEqual(saved.agentChanges, [])
  })
})

Deno.test('after the editor pulls and merges, an AI item the user deletes is not brought back', async () => {
  await withApp(async (req) => {
    const opened = await newCharacter(req)
    await addTags(req, opened.path, {
      agentName: 'a',
      tags: [{ text: 'glowing tattoo', addTo: [{ segment: 'base.other' }] }],
    })
    // 编辑页拉取：since=1
    const pulled = await (await req(
      `/characters/item/agent-changes?path=${
        encodeURIComponent(opened.path)
      }&since=1`,
    )).json()
    assert.equal(pulled.conflict, false)
    assert.equal(pulled.changes.length, 1)
    let content =
      applyAgentChanges(contentOf(opened), pulled.changes as AgentChange[])
        .content
    // 用户删掉 AI 加的条目，再以拉取后的版本保存
    const itemId = content.base.segments.other.items[0].id
    content = {
      ...content,
      base: {
        ...content.base,
        segments: {
          ...content.base.segments,
          other: removeItem(content.base.segments.other, itemId),
        },
      },
    }
    const r = await req(
      `/characters/item?path=${encodeURIComponent(opened.path)}`,
      json({ expectedVersion: pulled.version, content }, 'PUT'),
    )
    const saved = await r.json()
    assert.equal(saved.agentMerged, null)
    assert.equal(saved.base.segments.other.items.length, 0)
    // 标签库里的标签保留
    assert.equal(saved.customTags.length, 1)
  })
})

Deno.test('real concurrent user edits still conflict; pulling reports conflict', async () => {
  await withApp(async (req) => {
    const opened = await newCharacter(req)
    // 另一个标签页先保存了
    assert.equal((await userSave(req, { ...opened, title: 'A' })).status, 200)
    await addTags(req, opened.path, { agentName: 'a', tags: [{ text: 't' }] })
    const r = await userSave(req, { ...opened, title: 'B' }, 1)
    assert.equal(r.status, 409)
    const pulled = await (await req(
      `/characters/item/agent-changes?path=${
        encodeURIComponent(opened.path)
      }&since=1`,
    )).json()
    assert.equal(pulled.conflict, true)
  })
})

Deno.test('project archive does not include agent bookkeeping', async () => {
  await withApp(async (req) => {
    const c = await newCharacter(req)
    await addTags(req, c.path, { agentName: 'a', tags: [{ text: 't' }] })
    const archive = await (await req(
      `/characters/item/export/project?path=${encodeURIComponent(c.path)}`,
    ))
      .json()
    assert.equal('agentChanges' in archive.character, false)
    assert.equal('userVersion' in archive.character, false)
    // 标签和来源仍在存档里
    assert.equal(archive.character.customTags[0].origin, 'agent')
  })
})
