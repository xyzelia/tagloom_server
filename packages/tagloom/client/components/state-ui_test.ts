import assert from 'node:assert/strict'
import {
  addState,
  adjustmentsHeader,
  clearOverrideOutput,
  copyParentToOverride,
  duplicateStateIn,
  overrideChoice,
  parentSegmentFor,
  parseSeedInput,
  removeStateFrom,
  setOverrideChoice,
  updateStateIn,
  withStateSeed,
} from './state-ui.ts'
import {
  emptyBase,
  emptyCombo,
  emptySegment,
  emptyState,
  type PromptItem,
  type Segment,
  userOrigin,
} from '@app/tagloom/share'

function seg(text: string): Segment {
  const item = {
    id: 'i1',
    text,
    included: true,
    weight: 1,
    factId: null,
    ...userOrigin(),
  } as unknown as PromptItem
  return { ...emptySegment(), items: [item] }
}

Deno.test('seed parsing: valid, zero preserved, empty handling', () => {
  assert.deepEqual(parseSeedInput('0', false), { ok: true, value: 0 })
  assert.deepEqual(parseSeedInput(' 4294967295 ', true), {
    ok: true,
    value: 4294967295,
  })
  assert.deepEqual(parseSeedInput('', true), { ok: true, value: undefined })
  assert.equal(parseSeedInput('', false).ok, false)
})

Deno.test('seed parsing rejects instead of coercing', () => {
  for (const bad of ['-1', '1.5', '1e3', 'abc', '4294967296', '0x10', '1 2']) {
    assert.equal(parseSeedInput(bad, true).ok, false, bad)
  }
})

Deno.test('state CRUD keeps ids stable and duplicates keep seed', () => {
  let combo = emptyCombo('a')
  const a = addState(combo)
  combo = a.combo
  const b = addState(combo)
  combo = b.combo
  combo = updateStateIn(
    combo,
    a.state.id,
    (s) => withStateSeed({ ...s, name: 'x' }, 0),
  )
  assert.equal(combo.states[0].id, a.state.id)
  assert.equal(combo.states[0].seed, 0)
  const d = duplicateStateIn(combo, a.state.id)!
  assert.equal(d.combo.states.length, 3)
  assert.equal(d.combo.states[1].id, d.state.id)
  assert.notEqual(d.state.id, a.state.id)
  assert.equal(d.state.seed, 0)
  combo = removeStateFrom(d.combo, a.state.id)
  assert.equal(combo.states.length, 2)
  assert.equal(withStateSeed(d.state, undefined).seed, undefined)
  assert.equal('seed' in withStateSeed(d.state, undefined), false)
})

Deno.test('override choice: inherit removes, modes keep content', () => {
  let s = emptyState('s')
  assert.equal(overrideChoice(s, 'costume.top'), 'inherit')
  s = setOverrideChoice(s, 'costume.top', 'append')
  s = {
    ...s,
    overrides: { 'costume.top': { mode: 'append', content: seg('x') } },
  }
  s = setOverrideChoice(s, 'costume.top', 'replace')
  assert.equal(s.overrides['costume.top']!.content.items[0].text, 'x')
  s = setOverrideChoice(s, 'costume.top', 'inherit')
  assert.equal('costume.top' in s.overrides, false)
})

Deno.test('copy parent deep-clones; clear output is empty replace', () => {
  const parent = seg('red coat')
  let s = copyParentToOverride(emptyState(), 'costume.top', parent)
  const o = s.overrides['costume.top']!
  assert.equal(o.mode, 'replace')
  assert.equal(o.content.items[0].text, 'red coat')
  assert.notEqual(o.content.items[0].id, parent.items[0].id)
  s = clearOverrideOutput(s, 'costume.top')
  assert.equal(s.overrides['costume.top']!.content.items.length, 0)
  assert.equal(s.overrides['costume.top']!.mode, 'replace')
})

Deno.test('parent for base.hair includes combo hair override', () => {
  const base = emptyBase()
  base.segments.hair = seg('long')
  const combo = emptyCombo()
  assert.equal(parentSegmentFor(base, combo, 'base.hair').items[0].text, 'long')
  combo.hairOverride = { enabled: true, segment: seg('short') }
  assert.equal(
    parentSegmentFor(base, combo, 'base.hair').items[0].text,
    'short',
  )
})

Deno.test('adjustments header', () => {
  assert.deepEqual(adjustmentsHeader(emptyState()), {
    count: 0,
    labels: [],
    text: '沿用造型',
  })
  const s = clearOverrideOutput(emptyState(), 'costume.top')
  const h = adjustmentsHeader(s)
  assert.equal(h.count, 1)
  assert.match(h.text, /不输出/)
})
