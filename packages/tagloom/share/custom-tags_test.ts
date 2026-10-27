import assert from 'node:assert/strict'
import {
  addCustomTag,
  createCustomTag,
  customTagsForField,
  customTagUsage,
  removeCustomTag,
  updateCustomTag,
} from './custom-tags.ts'
import { segmentText } from './assemble.ts'
import { emptyContent, ORIGIN_LABEL } from './model.ts'
import { moveItem, pickCustomTag, removeItem, setItemText } from './segment.ts'
import { collectNotices } from './warnings.ts'

Deno.test('custom tags record who created them: user or agent (with agent name)', () => {
  const u = createCustomTag({ text: 'star-shaped ahoge', label: '星形呆毛' }, {
    origin: 'user',
  }, 1)
  const a = createCustomTag(
    { text: 'glowing blue tattoo on left arm', fields: ['recognition_mark'] },
    { origin: 'agent', agentName: 'tagloom-assistant' },
    2,
  )
  assert.deepEqual([u.origin, u.agentName, u.createdAt], ['user', '', 1])
  assert.deepEqual([a.origin, a.agentName], ['agent', 'tagloom-assistant'])
  // 人工创建不记录 agent 名
  const u2 = createCustomTag({ text: 'x' }, {
    origin: 'user',
    agentName: 'ignored',
  })
  assert.equal(u2.agentName, '')
  assert.equal(ORIGIN_LABEL[a.origin], '🤖 AI')
})

Deno.test('agent-created tags are usable right away and their origin survives edits', () => {
  let c = emptyContent()
  const t = createCustomTag({ text: 'heart-shaped pupils' }, {
    origin: 'agent',
    agentName: 'm',
  })
  c = addCustomTag(c, t)
  c.base.segments.eyes = pickCustomTag(c.base.segments.eyes, 'eye_detail', t)
  assert.equal(segmentText(c.base.segments.eyes), 'heart-shaped pupils')
  c = updateCustomTag(c, t.id, { text: 'heart pupils', label: '心形瞳孔' })
  assert.equal(c.customTags[0].origin, 'agent')
  assert.equal(c.customTags[0].agentName, 'm')
})

Deno.test('editing the library does not silently change items already in use', () => {
  let c = emptyContent()
  const t = createCustomTag({ text: 'star-shaped ahoge' }, { origin: 'user' })
  c = addCustomTag(c, t)
  c.base.segments.hair = pickCustomTag(
    c.base.segments.hair,
    'hair_extra_structure',
    t,
  )
  c = updateCustomTag(c, t.id, { text: '(star-shaped ahoge:1.2)' })
  assert.equal(segmentText(c.base.segments.hair), 'star-shaped ahoge')
  // 用户自己决定是否同步
  const item = c.base.segments.hair.items[0]
  c.base.segments.hair = setItemText(
    c.base.segments.hair,
    item.id,
    c.customTags[0].text,
  )
  assert.equal(segmentText(c.base.segments.hair), '(star-shaped ahoge:1.2)')
})

Deno.test('deleting a library tag keeps items in use and raises a notice', () => {
  let c = emptyContent()
  const t = createCustomTag({ text: 'star-shaped ahoge' }, { origin: 'user' })
  c = addCustomTag(c, t)
  c.base.segments.hair = pickCustomTag(c.base.segments.hair, null, t)
  c.combos[0].segments.accessory = pickCustomTag(
    c.combos[0].segments.accessory,
    null,
    t,
  )
  assert.equal(customTagUsage(c).get(t.id), 2)
  c = removeCustomTag(c, t.id)
  assert.equal(segmentText(c.base.segments.hair), 'star-shaped ahoge')
  assert.ok(
    collectNotices(c).some((n) => n.message.includes('自创标签已从标签库删除')),
  )
})

Deno.test('picking the same custom tag twice in one segment does not duplicate', () => {
  const t = createCustomTag({ text: 'a' }, { origin: 'user' })
  let s = emptyContent().base.segments.hair
  s = pickCustomTag(s, null, t)
  s = pickCustomTag(s, null, t)
  assert.equal(s.items.length, 1)
})

Deno.test('field filter: empty fields = shown everywhere', () => {
  const any = createCustomTag({ text: 'a' }, { origin: 'user' })
  const only = createCustomTag({ text: 'b', fields: ['eye_color'] }, {
    origin: 'user',
  })
  assert.deepEqual(
    customTagsForField([any, only], 'hair_color').map((t) => t.text),
    ['a'],
  )
  assert.deepEqual(
    customTagsForField([any, only], 'eye_color').map((t) => t.text),
    ['a', 'b'],
  )
})

Deno.test('items can be reordered and removed; order is the output order', () => {
  const a = createCustomTag({ text: 'a' }, { origin: 'user' })
  const b = createCustomTag({ text: 'b' }, { origin: 'agent' })
  let s = pickCustomTag(
    pickCustomTag(emptyContent().base.segments.hair, null, a),
    null,
    b,
  )
  assert.equal(segmentText(s), 'a, b')
  s = moveItem(s, s.items[1].id, -1)
  assert.equal(segmentText(s), 'b, a')
  s = removeItem(s, s.items[0].id)
  assert.equal(segmentText(s), 'a')
})
