import assert from 'node:assert/strict'
import {
  addTextItem,
  buildCharacterBundle,
  buildPromptBundle,
  buildSceneOutput,
  buildSceneText,
  buildSlotSnapshot,
  type CharacterContent,
  cleanSceneParams,
  emptyContent,
  emptySceneContent,
  emptySegment,
  emptySlot,
  emptyState,
  pickCustomTag,
  replaceSnapshot,
  type Scene,
  sceneCustomTagUsage,
  slotPrompt,
  snapshotPartToExtra,
  userOrigin,
} from './mod.ts'
import { createCustomTag } from './custom-tags.ts'

// 人物：Base 头发 + 一个组合（上装）+ 一个状态（微笑，替换头发）
function character(): CharacterContent {
  const c = emptyContent()
  c.title = '艾莉丝'
  c.negativePrompt = 'lowres, '
  c.base.subject = ' 1girl '
  c.base.segments.hair = addTextItem(c.base.segments.hair, 'long hair')
  const combo = c.combos[0]
  combo.segments.top = addTextItem(combo.segments.top, 'white shirt')
  const state = emptyState('微笑')
  state.expression = addTextItem(state.expression, 'smile')
  state.action = addTextItem(state.action, 'waving')
  state.overrides['base.hair'] = {
    mode: 'replace',
    content: addTextItem(emptySegment(), 'ponytail'),
  }
  combo.states.push(state)
  return c
}

Deno.test('snapshot without a state uses the combo and leaves expression / action empty', () => {
  const c = character()
  const snap = buildSlotSnapshot(c, 'a/艾莉丝.json', c.combos[0].id, null, 5)!
  assert.equal(snap.title, '艾莉丝')
  assert.equal(snap.subject, '1girl')
  assert.equal(snap.base, 'long hair')
  assert.equal(snap.costume, 'white shirt')
  assert.equal(snap.expression, '')
  assert.equal(snap.action, '')
  assert.equal(snap.negative, 'lowres')
  assert.equal(snap.stateId, null)
  assert.equal(snap.takenAt, 5)
  assert.ok(Object.values(snap.use).every(Boolean))
})

Deno.test('snapshot with a state applies its overrides', () => {
  const c = character()
  const combo = c.combos[0]
  const snap = buildSlotSnapshot(c, 'x.json', combo.id, combo.states[0].id, 1)!
  assert.equal(snap.stateName, '微笑')
  assert.equal(snap.base, 'ponytail')
  assert.equal(snap.expression, 'smile')
  assert.equal(snap.action, 'waving')
  // 不存在的组合 / 状态
  assert.equal(buildSlotSnapshot(c, 'x.json', 'nope', null, 1), null)
  assert.equal(
    buildSlotSnapshot(c, 'x.json', combo.id, 'nope', 1)!.stateId,
    null,
  )
})

Deno.test('replacing a snapshot keeps the slot id, part switches, extra and position', () => {
  const c = character()
  const combo = c.combos[0]
  let slot = emptySlot('主角')
  slot.snapshot = buildSlotSnapshot(c, 'x.json', combo.id, null, 1)
  slot.snapshot!.use.action = false
  slot.extra = addTextItem(slot.extra, 'looking at viewer')
  slot.position = { x: 0.3, y: 0.5 }
  const next = buildSlotSnapshot(c, 'x.json', combo.id, combo.states[0].id, 2)!
  const replaced = replaceSnapshot(slot, next)
  assert.equal(replaced.id, slot.id)
  assert.equal(replaced.snapshot!.expression, 'smile')
  assert.equal(replaced.snapshot!.use.action, false)
  assert.deepEqual(replaced.extra, slot.extra)
  assert.deepEqual(replaced.position, slot.position)
  // 空槽位第一次选择：开关全开
  slot = replaceSnapshot(emptySlot(), next)
  assert.equal(slot.snapshot!.use.action, true)
})

Deno.test('slot prompt joins enabled parts in order, then extra', () => {
  const c = character()
  const combo = c.combos[0]
  const slot = emptySlot()
  slot.snapshot = buildSlotSnapshot(
    c,
    'x.json',
    combo.id,
    combo.states[0].id,
    1,
  )
  slot.extra = addTextItem(slot.extra, 'holding cup')
  assert.equal(
    slotPrompt(slot),
    '1girl, ponytail, white shirt, smile, waving, holding cup',
  )
  slot.snapshot!.use.action = false
  slot.snapshot!.use.subject = false
  assert.equal(slotPrompt(slot), 'ponytail, white shirt, smile, holding cup')
  // 纯手写槽位
  const hand = emptySlot()
  hand.extra = addTextItem(hand.extra, '1boy, glasses')
  assert.equal(slotPrompt(hand), '1boy, glasses')
})

Deno.test('a snapshot part can become an editable extra item', () => {
  const c = character()
  const combo = c.combos[0]
  const slot = emptySlot()
  slot.snapshot = buildSlotSnapshot(
    c,
    'x.json',
    combo.id,
    combo.states[0].id,
    1,
  )
  const next = snapshotPartToExtra(slot, 'expression', userOrigin(1))
  assert.equal(next.snapshot!.use.expression, false)
  assert.equal(next.extra.items.length, 1)
  assert.equal(next.extra.items[0].text, 'smile')
  assert.equal(next.extra.items[0].field, null)
  // 输出不变：只是从快照挪到了补充
  assert.equal(slotPrompt(next), '1girl, ponytail, white shirt, waving, smile')
})

Deno.test('scene output matches the novelai request shape', () => {
  const c = character()
  const combo = c.combos[0]
  const content = emptySceneContent('黄昏的街道')
  content.content = addTextItem(content.content, 'street, sunset')
  content.negativePrompt = ' bad hands, '
  const a = emptySlot('左')
  a.snapshot = buildSlotSnapshot(c, 'x.json', combo.id, null, 1)
  a.position = { x: 0.25, y: 0.5 }
  const b = emptySlot()
  b.extra = addTextItem(b.extra, '1boy')
  content.slots = [a, b]
  const scene: Scene = {
    ...content,
    path: 's.json',
    version: 3,
    createdAt: 1,
    updatedAt: 2,
  }
  const out = buildSceneOutput(scene, 9)
  assert.equal(out.format, 'tagloom.scene-output')
  assert.equal(out.sourceVersion, 3)
  assert.equal(out.prompt, 'street, sunset')
  assert.equal(out.negativePrompt, 'bad hands')
  assert.deepEqual(out.characters, [
    {
      label: '左',
      prompt: '1girl, long hair, white shirt',
      negativePrompt: 'lowres',
      x: 0.25,
      y: 0.5,
    },
    { label: '人物 2', prompt: '1boy', negativePrompt: '', x: null, y: null },
  ])
  const text = buildSceneText(scene)
  assert.ok(text.startsWith('# 黄昏的街道\n'))
  assert.ok(text.includes('From: 艾莉丝 / 日常'))
  assert.ok(text.includes('Position: 0.25, 0.5'))
  // 发给其他模块的 Prompt 包与下游成品内容一致
  const bundle = buildPromptBundle(content)
  assert.equal(bundle.format, 'prompt-bundle')
  assert.deepEqual(
    [
      bundle.title,
      bundle.prompt,
      bundle.negativePrompt,
      bundle.characters,
      bundle.params,
    ],
    [out.title, out.prompt, out.negativePrompt, out.characters, out.params],
  )
  // 没填生成参数：输出空对象，纯文本没有参数段
  assert.deepEqual(out.params, {})
  assert.ok(!text.includes('## Parameters'))
})

Deno.test('scene params: only filled items are exported', () => {
  assert.equal(cleanSceneParams(undefined), undefined)
  assert.equal(cleanSceneParams({ model: '  ', sampler: '' }), undefined)
  assert.deepEqual(
    cleanSceneParams({ model: ' nai ', seed: 0, width: undefined }),
    { model: 'nai', seed: 0 },
  )
  const content = emptySceneContent('t')
  content.params = { width: 832, height: 1216, seed: 42, sampler: '' }
  const scene: Scene = {
    ...content,
    path: 's.json',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  }
  assert.deepEqual(buildSceneOutput(scene, 1).params, {
    width: 832,
    height: 1216,
    seed: 42,
  })
  assert.ok(
    buildSceneText(scene).endsWith(
      '## Parameters\nwidth: 832\nheight: 1216\nseed: 42\n',
    ),
  )
})

Deno.test('custom tag usage counts scene content and every slot extra', () => {
  const content = emptySceneContent()
  const tag = createCustomTag({ text: 'rim light' }, { origin: 'user' })
  content.customTags = [tag]
  content.content = pickCustomTag(content.content, null, tag)
  const slot = emptySlot()
  slot.extra = pickCustomTag(slot.extra, null, tag)
  content.slots = [slot]
  assert.equal(sceneCustomTagUsage(content).get(tag.id), 2)
})

Deno.test('character bundle: one unplaced character, empty main prompt, seed in params', () => {
  const c = character()
  const combo = c.combos[0]
  const state = combo.states[0]
  const b = buildCharacterBundle(c, combo.id, state.id)!
  const slot = {
    ...emptySlot(),
    snapshot: buildSlotSnapshot(c, '', combo.id, state.id, 0)!,
  }
  assert.equal(b.prompt, '')
  assert.equal(b.negativePrompt, '')
  assert.deepEqual(b.characters, [{
    label: '艾莉丝',
    prompt: slotPrompt(slot),
    negativePrompt: 'lowres',
    x: null,
    y: null,
  }])
  assert.equal(b.title, `艾莉丝 / ${combo.name || '未命名组合'} / 微笑`)
  assert.deepEqual(b.params, {})
  assert.deepEqual(
    buildCharacterBundle({ ...c, seed: 7 }, combo.id, null)!.params,
    {
      seed: 7,
    },
  )
  assert.equal(buildCharacterBundle(c, 'nope', null), null)
})
