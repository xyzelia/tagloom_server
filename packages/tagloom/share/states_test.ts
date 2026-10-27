import assert from 'node:assert/strict'
import {
  assembleBase,
  assembleCombo,
  assembleState,
  resolveEffectiveBase,
  resolveEffectiveCostume,
  segmentText,
} from './assemble.ts'
import { buildOutputArchive, buildOutputText } from './archive.ts'
import { characterContentSchema } from '../core/schema.ts'
import {
  type Character,
  type CharacterState,
  cloneSegment,
  contentOf,
  duplicateCombo,
  emptyContent,
  emptySegment,
  emptyState,
  type Segment,
  type StateOverride,
} from './model.ts'
import { addTextItem } from './segment.ts'
import { allSegments, customTagUsage } from './custom-tags.ts'
import {
  applyAgentChanges,
  findSegment,
  listSegments,
  updateSegmentAt,
} from './agent.ts'
import { hasComboContent, hasStateContent } from './presence.ts'
import { collectNotices } from './warnings.ts'
import {
  type BaseSegmentKey,
  type ComboSegmentKey,
  EXPRESSION_SEGMENT,
  STATE_OVERRIDE_TARGETS,
} from './fields.ts'

const seg = (...texts: string[]): Segment =>
  texts.reduce((s, t) => addTextItem(s, t), emptySegment())
const ov = (
  mode: StateOverride['mode'],
  ...texts: string[]
): StateOverride => ({ mode, content: seg(...texts) })

function sample() {
  const c = emptyContent()
  c.base.segments.hair = seg('blue hair')
  c.base.segments.eyes = seg('blue eyes')
  const combo = c.combos[0]
  combo.segments.top = seg('white shirt')
  combo.hairOverride = { enabled: true, segment: seg('short hair') }
  return c
}

function withState(
  patch: Partial<CharacterState> = {},
  seed?: number,
) {
  const c = sample()
  c.seed = seed
  const state = { ...emptyState('smile'), ...patch }
  c.combos[0].states = [state]
  return { c, combo: c.combos[0], state }
}

Deno.test('expression and action are text-first segments without guessed catalog paths', () => {
  assert.equal(EXPRESSION_SEGMENT.fields[0].strategy, 'text_first')
  assert.deepEqual(EXPRESSION_SEGMENT.fields[0].categoryPaths, [])
})

Deno.test('precedence is base -> combo hair override -> state; no state leaves output unchanged', () => {
  const { c, combo } = withState()
  const plain = assembleCombo(c, combo)
  assert.equal(plain.full, 'short hair, blue eyes, white shirt')
  assert.equal(plain.hairSource, 'override')
  assert.equal(plain.state, undefined)
  // 空状态：输出与无状态一致
  const empty = assembleCombo(c, combo, combo.states[0])
  assert.equal(empty.full, plain.full)

  combo.states[0].overrides['base.hair'] = ov('append', 'ahoge')
  assert.equal(
    assembleCombo(c, combo, combo.states[0]).base,
    'short hair, ahoge, blue eyes',
  )
  assert.equal(assembleCombo(c, combo, combo.states[0]).hairSource, 'state')
  combo.states[0].overrides['base.hair'] = ov('replace', 'wet hair')
  assert.equal(
    assembleState(c, combo, combo.states[0]).base,
    'wet hair, blue eyes',
  )
})

Deno.test('replace with empty content clears; append keeps parent; no mutation or dedup', () => {
  const { c, combo, state } = withState({
    expression: seg('smile'),
    action: seg('waving'),
  })
  state.overrides['costume.top'] = ov('replace')
  state.overrides['base.eyes'] = ov('append', 'blue eyes')
  const before = structuredClone(c)
  const r = assembleState(c, combo, state)
  assert.equal(r.costume, '')
  assert.equal(r.base, 'short hair, blue eyes, blue eyes') // 不去重
  assert.equal(r.full, 'short hair, blue eyes, blue eyes, smile, waving')
  assert.deepEqual(c, before)
  assert.equal(assembleBase(c), 'blue hair, blue eyes')
})

Deno.test('effective seed: state overrides character, 0 is a real seed', () => {
  assert.equal(withState({}, 5).c.seed, 5)
  let x = withState({}, 7)
  assert.equal(assembleState(x.c, x.combo, x.state).effectiveSeed, 7)
  x = withState({ seed: 0 }, 7)
  assert.equal(assembleState(x.c, x.combo, x.state).effectiveSeed, 0)
  x = withState({}, 0)
  assert.equal(assembleState(x.c, x.combo, x.state).effectiveSeed, 0)
  x = withState({})
  assert.equal(assembleState(x.c, x.combo, x.state).effectiveSeed, undefined)
})

Deno.test('schema: seed range, targets and modes are enforced; legacy combos default states', () => {
  const { c } = withState({ seed: 0 }, 4294967295)
  assert.equal(characterContentSchema.safeParse(c).success, true)
  const bad = (f: (x: ReturnType<typeof sample>) => void) => {
    const x = structuredClone(sample())
    x.combos[0].states = [emptyState('s')]
    f(x)
    return characterContentSchema.safeParse(x).success
  }
  assert.equal(bad((x) => (x.seed = -1)), false)
  assert.equal(bad((x) => (x.seed = 4294967296)), false)
  assert.equal(bad((x) => (x.seed = 1.5)), false)
  assert.equal(bad((x) => (x.combos[0].states[0].seed = -1)), false)
  assert.equal(
    bad((x) => // deno-lint-ignore no-explicit-any
    ((x.combos[0].states[0].overrides as any)['costume.nope'] = ov('append'))),
    false,
  )
  assert.equal(
    bad((x) => // deno-lint-ignore no-explicit-any
    ((x.combos[0].states[0].overrides as any)['hair'] = ov('append'))),
    false,
  )
  assert.equal(
    bad((x) => // deno-lint-ignore no-explicit-any
    ((x.combos[0].states[0].overrides as any)['base.hair'] = ov(
      'merge' as any,
    ))),
    false,
  )
  for (const t of STATE_OVERRIDE_TARGETS) {
    assert.equal(
      bad((x) => (x.combos[0].states[0].overrides[t] = ov('replace'))),
      true,
    )
  }
  const legacy = structuredClone(sample()) as unknown as {
    combos: { states?: unknown }[]
  }
  delete legacy.combos[0].states
  const parsed = characterContentSchema.safeParse(legacy)
  assert.equal(parsed.success, true)
  assert.deepEqual(parsed.data!.combos[0].states, [])
})

Deno.test('contentOf defaults missing states and keeps seed (including 0)', () => {
  const c = { ...sample(), seed: 0 } as unknown as Character
  // deno-lint-ignore no-explicit-any
  delete (c.combos[0] as any).states
  const content = contentOf(c)
  assert.deepEqual(content.combos[0].states, [])
  assert.equal(content.seed, 0)
})

Deno.test('duplicateCombo copies states with new ids and independent data', () => {
  const { combo, state } = withState({ expression: seg('smile') })
  state.overrides['base.hair'] = ov('replace', 'x')
  const copy = duplicateCombo(combo, 'copy')
  assert.notEqual(copy.states[0].id, state.id)
  copy.states[0].overrides['base.hair']!.content.items[0].text = 'changed'
  assert.equal(state.overrides['base.hair']!.content.items[0].text, 'x')
})

Deno.test('presence, custom tag usage, warnings and agent traversals include states', () => {
  const { c, combo, state } = withState()
  combo.segments.top = emptySegment()
  combo.hairOverride = { enabled: false, segment: emptySegment() }
  assert.equal(hasComboContent(combo), false)
  state.expression = seg('smile')
  assert.equal(hasComboContent(combo), true)
  state.expression = emptySegment()
  state.overrides['costume.top'] = ov('replace')
  assert.equal(hasComboContent(combo), true) // 空 replace 也是记录

  state.action = {
    ...seg('wave'),
    items: [{
      ...seg('wave').items[0],
      source: { kind: 'custom', customId: 'gone' },
    }],
  }
  assert.equal(customTagUsage(c).get('gone'), 1)
  assert.ok(
    collectNotices(c).some((n) =>
      n.message.includes('已从标签库删除') && n.segment.startsWith('state.')
    ),
  )
  const base = emptyContent()
  base.combos[0].states = [emptyState('s')]
  assert.equal(
    allSegments(base).length - allSegments(emptyContent()).length,
    2,
  )
})

Deno.test('agent addresses list and update state segments while preserving data', () => {
  const { c, combo, state } = withState({ seed: 0 })
  state.overrides['base.hair'] = ov('replace', 'x')
  const prefix = `combo.${combo.id}.state.${state.id}`
  const addresses = listSegments(c).map((s) => s.address)
  for (const a of ['expression', 'action', 'override.base.hair']) {
    assert.ok(addresses.includes(`${prefix}.${a}`), a)
  }
  assert.ok(!addresses.includes(`${prefix}.override.base.eyes`))
  const before = structuredClone(c)
  const next = updateSegmentAt(
    c,
    `${prefix}.override.base.hair`,
    (s) => addTextItem(s, 'y'),
  )
  const o = next.combos[0].states[0].overrides['base.hair']!
  assert.equal(o.mode, 'replace')
  assert.deepEqual(o.content.items.map((i) => i.text), ['x', 'y'])
  assert.equal(next.combos[0].states[0].seed, 0)
  assert.deepEqual(c, before) // 不修改原对象
  const e = updateSegmentAt(
    c,
    `${prefix}.expression`,
    (s) => addTextItem(s, 'smile'),
  )
  assert.equal(findSegment(e, `${prefix}.expression`)!.segment.items.length, 1)
  // 未存在的覆盖、未知地址：原样返回
  assert.equal(updateSegmentAt(c, `${prefix}.override.base.eyes`, (s) => s), c)
  assert.equal(updateSegmentAt(c, `${prefix}.override.nope`, (s) => s), c)
  assert.equal(
    updateSegmentAt(c, `combo.${combo.id}.state.zzz.action`, (s) => s),
    c,
  )
})

Deno.test('output archive and text carry resolved state prompts and effective seed', () => {
  const { c, combo, state } = withState({ expression: seg('smile') }, 0)
  state.overrides['costume.top'] = ov('replace')
  const full = { ...c, id: 'i', version: 1 } as unknown as Character
  const out = buildOutputArchive(full, 1_000)
  assert.equal(out.character.seed, 0)
  const s = out.character.combos[0].states![0]
  assert.equal(s.seed, 0)
  assert.equal(s.fullPrompt, 'short hair, blue eyes, smile')
  assert.equal(s.costume, '')
  const text = buildOutputText(full)
  assert.ok(text.includes('Seed: 0'))
  assert.ok(text.includes('Prompt: short hair, blue eyes, smile'))
  // 无状态且无种子：输出不含 states / seed
  const plain = buildOutputArchive(
    { ...sample(), id: 'i', version: 1 } as unknown as Character,
    1_000,
  )
  assert.equal('seed' in plain.character, false)
  assert.equal('states' in plain.character.combos[0], false)
  assert.ok(
    !buildOutputText(
      { ...sample(), id: 'i', version: 1 } as unknown as Character,
    ).includes('Seed'),
  )
  void combo
})

Deno.test('every override target applies append, replace and explicit clearing', () => {
  for (const target of STATE_OVERRIDE_TARGETS) {
    const { c, combo, state } = withState()
    const isBase = target.startsWith('base.')
    const key = target.slice(isBase ? 5 : 8)
    if (isBase) {
      c.base.segments[key as BaseSegmentKey] = seg('parent')
      combo.hairOverride.enabled = false
    } else combo.segments[key as ComboSegmentKey] = seg('parent')
    const text = () =>
      segmentText(
        isBase
          ? resolveEffectiveBase(c.base, combo, state)[key as BaseSegmentKey]
          : resolveEffectiveCostume(combo, state)[key as ComboSegmentKey],
      )
    assert.equal(text(), 'parent', target)
    state.overrides[target] = ov('append', 'extra')
    assert.equal(text(), 'parent, extra', target)
    state.overrides[target] = ov('replace', 'changed')
    assert.equal(text(), 'changed', target)
    state.overrides[target] = ov('replace')
    assert.equal(text(), '', target)
    delete state.overrides[target]
    assert.equal(text(), 'parent', target)
  }
})

Deno.test('segment cloning remaps fact references and drops dangling references', () => {
  const original = seg('smile', 'wave')
  original.facts = [{
    id: 'fact',
    field: 'expression',
    text: 'smile',
    sourceQuote: '',
    status: 'confirmed',
    locked: true,
    candidates: [],
    searchedAt: null,
    searchVerified: false,
  }]
  original.items[0].factId = 'fact'
  original.items[1].factId = 'missing'
  const copy = cloneSegment(original)
  assert.notEqual(copy.facts[0].id, 'fact')
  assert.equal(copy.items[0].factId, copy.facts[0].id)
  assert.equal(copy.items[1].factId, null)
  assert.notEqual(copy.items[0].id, original.items[0].id)
  assert.equal(original.items[1].factId, 'missing')
})

Deno.test('seed-only state is recorded content, including seed zero', () => {
  const state = emptyState()
  assert.equal(hasStateContent(state), false)
  state.seed = 0
  assert.equal(hasStateContent(state), true)
})

Deno.test('existing AI additions preserve state data and seed overrides', () => {
  const { c, combo, state } = withState({ seed: 0 }, 42)
  state.overrides['costume.top'] = ov('replace')
  const before = structuredClone(c)
  const item = { ...seg('ahoge').items[0], origin: 'agent' as const }
  const merged = applyAgentChanges(c, [{
    version: 2,
    agentName: 'test',
    at: 1_000,
    tags: [],
    items: [{ segment: 'base.hair', item }],
  }]).content
  assert.equal(merged.seed, 42)
  assert.deepEqual(merged.combos[0].states, combo.states)
  assert.equal(merged.combos[0].states[0].seed, 0)
  assert.deepEqual(c, before)
})
