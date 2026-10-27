import assert from 'node:assert/strict'
import type { CatalogHit } from './catalog.ts'
import {
  addFact,
  applySearch,
  decideCandidate,
  isSourceStale,
  removeFact,
  setFactLocked,
} from './facts.ts'
import { segmentText } from './assemble.ts'
import { emptyContent, emptySegment } from './model.ts'
import { pickCatalogTag, setFieldState, setIncluded } from './segment.ts'
import { collectNotices } from './warnings.ts'

const hit = (
  canonical: string,
  match: CatalogHit['match'] = 'label',
): CatalogHit => ({
  canonical,
  labelZh: '蓝发',
  labelEn: canonical,
  labelJa: '',
  aliases: [],
  postCount: 1,
  notes: '',
  categoryPath: 'character.body.hair.color',
  categoryLabelZh: '颜色',
  sources: ['tags-tree'],
  match,
  evidence: '蓝发',
  inField: true,
})

function factSeg() {
  const seg = addFact(emptySegment(), {
    field: 'hair_color',
    text: '蓝色',
    sourceQuote: '蓝色长发',
  })
  return { seg, id: seg.facts[0].id }
}

Deno.test('search results are pending candidates, exact match is not auto-confirmed', () => {
  const { seg, id } = factSeg()
  const s = applySearch(seg, id, [hit('blue hair', 'canonical')], 'v3', 1_000)
  const f = s.facts[0]
  assert.equal(f.status, 'pending')
  assert.equal(f.candidates[0].decision, 'pending')
  assert.equal(f.searchVerified, true)
  assert.equal(s.items.length, 0)
})

Deno.test('unverified search is marked as not checked', () => {
  const { seg, id } = factSeg()
  const s = applySearch(seg, id, [], null, 1_000)
  assert.equal(s.facts[0].searchVerified, false)
  assert.equal(s.facts[0].searchedAt, 1_000)
})

Deno.test('confirm adds an included item linked to the fact; reject removes it, keeps the fact', () => {
  const { seg, id } = factSeg()
  let s = applySearch(seg, id, [hit('blue hair')], 'v3', 1_000)
  const cid = s.facts[0].candidates[0].id
  s = decideCandidate(s, id, cid, 'confirmed')
  assert.equal(s.facts[0].status, 'confirmed')
  assert.deepEqual(s.items.map((x) => [x.text, x.factId, x.included]), [[
    'blue hair',
    id,
    true,
  ]])
  assert.equal(segmentText(s), 'blue hair')
  // 重复确认不重复加入
  s = decideCandidate(s, id, cid, 'confirmed')
  assert.equal(s.items.length, 1)
  s = decideCandidate(s, id, cid, 'rejected')
  assert.equal(s.items.length, 0)
  assert.equal(s.facts.length, 1)
  assert.equal(s.facts[0].status, 'pending')
})

Deno.test('confirming a tag already picked by hand re-checks it instead of duplicating; reject leaves the hand pick', () => {
  const { seg, id } = factSeg()
  let s = pickCatalogTag(seg, 'hair_color', {
    canonical: 'blue hair',
    labelZh: '蓝发',
    categoryPath: 'x',
    catalogVersion: 'v3',
  })
  s = setIncluded(s, s.items[0].id, false)
  s = applySearch(s, id, [hit('blue hair')], 'v3', 1_000)
  s = decideCandidate(s, id, s.facts[0].candidates[0].id, 'confirmed')
  assert.equal(s.items.length, 1)
  assert.equal(s.items[0].included, true)
})

Deno.test('re-search keeps decided candidates and replaces pending ones', () => {
  const { seg, id } = factSeg()
  let s = applySearch(
    seg,
    id,
    [hit('blue hair'), hit('light blue hair')],
    'v3',
    1_000,
  )
  s = decideCandidate(s, id, s.facts[0].candidates[0].id, 'confirmed')
  s = applySearch(s, id, [hit('blue hair'), hit('aqua hair')], 'v3', 2_000)
  const c = s.facts[0].candidates.map((x) => [x.tags[0].canonical, x.decision])
  assert.deepEqual(c, [['blue hair', 'confirmed'], ['aqua hair', 'pending']])
})

Deno.test('locked facts are not rewritten by search or decisions', () => {
  const { seg, id } = factSeg()
  let s = applySearch(seg, id, [hit('blue hair')], 'v3', 1_000)
  s = setFactLocked(s, id, true)
  const before = s.facts[0]
  s = applySearch(s, id, [hit('red hair')], 'v3', 2_000)
  s = decideCandidate(s, id, before.candidates[0].id, 'confirmed')
  assert.deepEqual(s.facts[0], before)
  assert.equal(s.items.length, 0)
})

Deno.test('removing a fact keeps its items, unlinked', () => {
  const { seg, id } = factSeg()
  let s = applySearch(seg, id, [hit('blue hair')], 'v3', 1_000)
  s = decideCandidate(s, id, s.facts[0].candidates[0].id, 'confirmed')
  s = removeFact(s, id)
  assert.equal(s.facts.length, 0)
  assert.equal(s.items[0].factId, null)
  assert.equal(segmentText(s), 'blue hair')
})

Deno.test('source quote staleness follows profile edits', () => {
  const { seg } = factSeg()
  assert.equal(isSourceStale(seg.facts[0], '她有蓝色长发'), false)
  assert.equal(isSourceStale(seg.facts[0], '她有红色短发'), true)
})

Deno.test('field marked N/A but still output produces a notice, not an error', () => {
  const c = emptyContent()
  const tag = {
    canonical: 'blunt bangs',
    labelZh: '齐刘海',
    categoryPath: 'x',
    catalogVersion: null,
  }
  let hair = pickCatalogTag(c.base.segments.hair, 'bangs_shape', tag)
  hair = setFieldState(hair, 'bangs_shape', 'na')
  c.base.segments.hair = hair
  const msgs = collectNotices(c).map((n) => n.message)
  assert.ok(msgs.some((m) => m.includes('刘海形状') && m.includes('N/A')))
  // 取消勾选后不再提示
  c.base.segments.hair = setIncluded(hair, hair.items[0].id, false)
  assert.ok(!collectNotices(c).some((n) => n.message.includes('刘海形状')))
})
