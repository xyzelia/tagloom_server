import assert from 'node:assert/strict'
import {
  segmentCategoryPaths,
  segmentFieldFor,
  suggestTagTargets,
  TAG_TARGETS,
  tagTarget,
} from './tag-targets.ts'
import { ACTION_SEGMENT, BASE_SEGMENTS, EXPRESSION_SEGMENT } from './fields.ts'

const keys = (path: string) =>
  suggestTagTargets(path).map((t) => `${t.key}/${t.field}`)

Deno.test('catalog categories map to the matching base / costume segment and field', () => {
  assert.deepEqual(keys('character.body.hair.color'), ['base.hair/hair_color'])
  assert.deepEqual(keys('character.body.eye.color'), ['base.eyes/eye_color'])
  assert.deepEqual(keys('apparel.garment.top'), ['costume.top/top'])
  // 子分类也匹配；只在一处出现的具体字段优先
  assert.deepEqual(keys('apparel.garment.top.shirt'), ['costume.top/top'])
  assert.deepEqual(keys('apparel.footwear'), ['costume.footwear/footwear'])
})

Deno.test('expressions and actions are suggested to the current state', () => {
  assert.deepEqual(keys('dynamics.expression'), [
    'state.expression/expression',
  ])
  assert.deepEqual(keys('dynamics.pose.sitting'), ['state.action/action'])
  assert.deepEqual(keys('dynamics.action'), ['state.action/action'])
})

Deno.test('unmapped categories and per-garment details have no suggestion', () => {
  assert.deepEqual(keys('object.weapon_type'), [])
  assert.deepEqual(keys(''), [])
  // 袖型、图案等部件字段每件衣物都有，判断不出是哪件
  assert.deepEqual(keys('apparel.detail.pattern.stripe'), [])
  assert.deepEqual(keys('apparel.detail.sleeve'), [])
  // 只匹配完整路径段，不按字符串前缀误配
  assert.deepEqual(keys('character.body.hair.colorful'), [])
})

Deno.test('every segment can be chosen manually exactly once', () => {
  const all = TAG_TARGETS.map((t) => t.key)
  assert.equal(new Set(all).size, all.length)
  assert.ok(all.includes('base.hair'))
  assert.ok(all.includes('costume.underwear_other'))
  assert.ok(all.includes('state.action'))
  assert.equal(tagTarget('base.eyes')?.label, 'Base · 眼睛')
  assert.equal(tagTarget('nope'), undefined)
})

Deno.test('segment search covers every field category of the segment and records the best field', () => {
  const hair = BASE_SEGMENTS.find((d) => d.key === 'hair')!
  const paths = segmentCategoryPaths(hair)
  assert.ok(paths.includes('character.body.hair.color'))
  assert.equal(new Set(paths).size, paths.length)
  assert.equal(
    segmentFieldFor(hair, 'character.body.hair.color.streaks'),
    'hair_color',
  )
  // 匹配不上时用第一个字段
  assert.equal(segmentFieldFor(hair, 'scene.indoor'), hair.fields[0].key)
  // 神态 / 动作没有字段分类，用提示分类
  assert.deepEqual(segmentCategoryPaths(EXPRESSION_SEGMENT), [
    'dynamics.expression',
  ])
  assert.ok(segmentCategoryPaths(ACTION_SEGMENT).includes('dynamics.pose'))
})
