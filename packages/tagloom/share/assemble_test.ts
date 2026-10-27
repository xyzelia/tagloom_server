import assert from 'node:assert/strict'
import {
  assembleBase,
  assembleCombo,
  joinSegments,
  segmentText,
} from './assemble.ts'
import { buildOutputArchive, buildOutputText } from './archive.ts'
import {
  type Character,
  emptyCombo,
  emptyContent,
  emptySegment,
  type Segment,
} from './model.ts'
import { addTextItem, pickCatalogTag, setIncluded } from './segment.ts'
import { collectNotices } from './warnings.ts'

const ref = (canonical: string) => ({
  canonical,
  labelZh: '',
  categoryPath: 'x',
  catalogVersion: 'v3',
})
// 用文本条目快速构造一个分类
const seg = (...texts: string[]): Segment =>
  texts.reduce((s, t) => addTextItem(s, t), emptySegment())

function sample() {
  const c = emptyContent()
  c.base.segments.hair = seg('blue long hair, straight hair', 'blunt bangs')
  c.base.segments.eyes = seg('blue eyes')
  c.base.segments.body = seg('(medium breasts:1.1)')
  const combo = c.combos[0]
  combo.segments.overall = seg('red bikini, halterneck')
  combo.segments.top = seg('white sleeveless shirt')
  combo.segments.bottom = seg('blue skirt')
  return c
}

Deno.test('joins included items in order; keeps user text and weights', () => {
  const c = sample()
  const a = assembleCombo(c, c.combos[0])
  assert.equal(
    a.base,
    'blue long hair, straight hair, blunt bangs, blue eyes, (medium breasts:1.1)',
  )
  assert.equal(
    a.costume,
    'red bikini, halterneck, white sleeveless shirt, blue skirt',
  )
  assert.equal(a.full, `${a.base}, ${a.costume}`)
  assert.equal(a.hairSource, 'base')
})

Deno.test('unchecked items stay in the list but are not output', () => {
  let s = pickCatalogTag(emptySegment(), 'hair_color', ref('blue hair'))
  s = pickCatalogTag(s, 'bangs_shape', ref('blunt bangs'))
  s = addTextItem(s, '(long hair:1.2)')
  assert.equal(segmentText(s), 'blue hair, blunt bangs, (long hair:1.2)')
  s = setIncluded(s, s.items[1].id, false)
  assert.equal(segmentText(s), 'blue hair, (long hair:1.2)')
  assert.equal(s.items.length, 3)
})

Deno.test('hair override replaces base hair for that combo only, without stacking', () => {
  const c = sample()
  const sport = emptyCombo('运动')
  sport.hairOverride = {
    enabled: true,
    segment: seg('blue hair, high ponytail'),
  }
  c.combos.push(sport)
  const daily = assembleCombo(c, c.combos[0])
  const s = assembleCombo(c, sport)
  assert.equal(s.hairSource, 'override')
  assert.equal(
    s.base,
    'blue hair, high ponytail, blue eyes, (medium breasts:1.1)',
  )
  assert.ok(daily.base.startsWith('blue long hair'))
  // 共享 Base 不被改写
  assert.equal(
    segmentText(c.base.segments.hair),
    'blue long hair, straight hair, blunt bangs',
  )
})

Deno.test('enabled but empty override gives an empty hair segment and a notice', () => {
  const c = sample()
  c.combos[0].hairOverride.enabled = true
  assert.equal(
    assembleCombo(c, c.combos[0]).base,
    'blue eyes, (medium breasts:1.1)',
  )
  const notices = collectNotices(c).map((n) => n.message)
  assert.ok(notices.some((m) => m.includes('发型覆盖：已启用但没有勾选的条目')))
})

Deno.test('boundary commas and whitespace are trimmed; inner text untouched', () => {
  assert.equal(joinSegments([' a,  b ,', '', ', c', '  ']), 'a,  b, c')
})

Deno.test('duplicates are reported, never removed', () => {
  const c = sample()
  c.combos[0].segments.legwear = seg('blue skirt')
  const a = assembleCombo(c, c.combos[0])
  assert.equal(a.costume.split('blue skirt').length - 1, 2)
  const msgs = collectNotices(c).map((n) => n.message)
  assert.ok(
    msgs.some((m) => m.includes('重复条目') && m.includes('blue skirt')),
  )
})

Deno.test('output archive has override already applied and per-combo prompts', () => {
  const c: Character = {
    ...sample(),
    path: 'c1.json',
    version: 3,
    userVersion: 3,
    agentChanges: [],
    createdAt: 0,
    updatedAt: 0,
  }
  c.combos[0].hairOverride = { enabled: true, segment: seg('twin braids') }
  const out = buildOutputArchive(c, Date.UTC(2026, 9, 9))
  assert.equal(out.formatVersion, 2)
  const combo = out.character.combos[0]
  assert.equal(combo.hair, 'twin braids')
  assert.equal(combo.hairSource, 'override')
  assert.ok(combo.fullPrompt.startsWith('twin braids, blue eyes'))
  assert.equal(
    out.character.base.hair,
    'blue long hair, straight hair, blunt bangs',
  )
  assert.equal(out.sourceVersion, 3)
  assert.ok(buildOutputText(c).includes(`Prompt: ${combo.fullPrompt}`))
  assert.equal(assembleBase(c).startsWith('blue long hair'), true)
})
