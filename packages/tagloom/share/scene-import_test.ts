import assert from 'node:assert/strict'
import type { NovelaiImageMeta } from '@app/shared/novelai'
import type { TagRef } from './model.ts'
import { emptySceneContent, emptySlot, MAX_SCENE_SLOTS } from './scene.ts'
import {
  applySceneImport,
  planSceneImport as planFromSource,
  sceneImportCores as coresFromSource,
  snapToGrid,
  sourceFromBundle,
  sourceFromNovelaiMeta,
} from './scene-import.ts'

// 图片元数据的便捷入口（原来的测试都按图片写）
const planSceneImport = (
  m: NovelaiImageMeta,
  l: ReadonlyMap<string, TagRef>,
) => planFromSource(sourceFromNovelaiMeta(m), l)
const sceneImportCores = (m: NovelaiImageMeta) =>
  coresFromSource(sourceFromNovelaiMeta(m))
import { pickCatalogTag } from './segment.ts'

const tag = (canonical: string, labelZh = canonical): TagRef => ({
  canonical,
  labelZh,
  categoryPath: 'test',
  catalogVersion: 'v1',
})
const meta = (patch: Partial<NovelaiImageMeta> = {}): NovelaiImageMeta => ({
  software: 'NovelAI',
  source: null,
  requestType: null,
  prompt: '2girls, {rain}, (night sky:1.2), 1.1::neon, glow::, smiling',
  negative: 'lowres',
  characters: [
    { prompt: 'red hair', negative: 'bad hands', center: { x: 0.28, y: 0.52 } },
    { prompt: 'blue hair', negative: '', center: { x: 0.5, y: 0.5 } },
  ],
  useCoords: true,
  img2img: null,
  comment: {},
  ...patch,
})
const lookup = new Map([
  ['rain', tag('rain', '雨')],
  ['night sky', tag('night sky', '夜空')],
  ['smiling', tag('smile', '微笑')],
  ['red hair', tag('red hair', '红发')],
])

Deno.test('sceneImportCores lists unique bare tags from prompt and characters', () => {
  assert.deepEqual(sceneImportCores(meta()), [
    '2girls',
    'rain',
    'night sky',
    'smiling',
    'red hair',
    'blue hair',
  ])
})

Deno.test('snapToGrid snaps to 5x5 cell centers', () => {
  assert.deepEqual([0, 0.28, 0.5, 0.61, 1].map(snapToGrid), [
    0.1,
    0.3,
    0.5,
    0.7,
    0.9,
  ])
})

Deno.test('plan: catalog hits keep the original weighted text; character negatives merge', () => {
  const plan = planSceneImport(meta(), lookup)
  assert.deepEqual(
    plan.content.map((p) => [p.text, p.tag?.canonical ?? null]),
    [
      ['2girls', null],
      ['{rain}', 'rain'],
      ['(night sky:1.2)', 'night sky'],
      ['1.1::neon, glow::', null],
      ['smiling', 'smile'],
    ],
  )
  assert.equal(plan.negative, 'lowres, bad hands')
  assert.match(plan.notes[0], /1 个角色的负面/)
  assert.deepEqual(plan.characters.map((c) => c.position), [
    { x: 0.3, y: 0.5 },
    { x: 0.5, y: 0.5 },
  ])
  // 没开 use_coords：不指定位置
  const free = planSceneImport(meta({ useCoords: false }), lookup)
  assert.deepEqual(free.characters.map((c) => c.position), [null, null])
})

Deno.test('apply append: adds items and slots, keeps existing, re-includes duplicate catalog tags', () => {
  const base = emptySceneContent('t')
  base.content = pickCatalogTag(base.content, null, tag('rain', '雨'))
  base.content.items[0].included = false
  base.negativePrompt = 'blurry'
  base.slots = [emptySlot('原有')]
  const plan = planSceneImport(meta(), lookup)
  const all = new Set(['content', 'negative', 'characters'] as const)
  const next = applySceneImport(base, plan, all, 'append')

  const items = next.content.items
  assert.deepEqual(items.map((i) => [i.source.kind, i.text, i.included]), [
    ['catalog', 'rain', true], // 已有的 rain 只重新勾选，不重复添加
    ['text', '2girls', true],
    ['catalog', '(night sky:1.2)', true],
    ['text', '1.1::neon, glow::', true],
    ['catalog', 'smiling', true],
  ])
  assert.equal(next.negativePrompt, 'blurry, lowres, bad hands')
  assert.equal(next.slots.length, 3)
  assert.equal(next.slots[0].label, '原有')
  assert.deepEqual(next.slots[1].extra.items.map((i) => i.source.kind), [
    'catalog',
  ])
  assert.deepEqual(next.slots[1].position, { x: 0.3, y: 0.5 })
  assert.equal(next.title, 't')
})

Deno.test('apply replace clears content, negative and slots; groups and slot limit are respected', () => {
  const base = emptySceneContent('t')
  base.note = 'keep'
  base.negativePrompt = 'blurry'
  base.slots = [emptySlot('原有')]
  const plan = planSceneImport(meta(), lookup)
  const next = applySceneImport(
    base,
    plan,
    new Set(['characters'] as const),
    'replace',
  )
  assert.equal(next.content.items.length, 0)
  assert.equal(next.negativePrompt, '')
  assert.equal(next.slots.length, 2)
  assert.equal(next.note, 'keep')

  const many = planSceneImport(
    meta({
      characters: Array.from({ length: MAX_SCENE_SLOTS + 2 }, () => ({
        prompt: 'x',
        negative: '',
        center: null,
      })),
    }),
    lookup,
  )
  base.slots = [emptySlot(), emptySlot()]
  const capped = applySceneImport(
    base,
    many,
    new Set(['characters'] as const),
    'append',
  )
  assert.equal(capped.slots.length, MAX_SCENE_SLOTS)
})

Deno.test('plan params: comment keys map to scene params, out-of-range values are dropped', () => {
  const plan = planSceneImport(
    meta({
      comment: {
        width: 832,
        height: 1216,
        steps: 28,
        scale: 5.5,
        cfg_rescale: 3,
        sampler: 'k_euler_ancestral',
        noise_schedule: ' karras ',
        seed: 0,
        sm: true,
      },
    }),
    lookup,
  )
  assert.deepEqual(plan.params, {
    width: 832,
    height: 1216,
    steps: 28,
    scale: 5.5,
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    seed: 0,
  })
  assert.ok(plan.notes.some((n) => n.includes('CFG Rescale 3')))
  // 没有 Comment：没有参数
  assert.deepEqual(planSceneImport(meta({ comment: null }), lookup).params, {})
})

Deno.test('apply params: append overrides same keys, replace swaps the whole set, unchecked keeps', () => {
  const base = emptySceneContent('t')
  base.params = { width: 512, model: 'm', seed: 1 }
  const plan = planSceneImport(
    meta({ comment: { seed: 9, steps: 28 } }),
    lookup,
  )
  const groups = new Set(['params'] as const)
  assert.deepEqual(applySceneImport(base, plan, groups, 'append').params, {
    width: 512,
    model: 'm',
    seed: 9,
    steps: 28,
  })
  assert.deepEqual(applySceneImport(base, plan, groups, 'replace').params, {
    seed: 9,
    steps: 28,
  })
  const none = new Set(['content'] as const)
  assert.deepEqual(
    applySceneImport(base, plan, none, 'replace').params,
    base.params,
  )
  // 图片没有参数、整份替换：清空
  const empty = planSceneImport(meta({ comment: null }), lookup)
  assert.equal(
    applySceneImport(base, empty, groups, 'replace').params,
    undefined,
  )
})

Deno.test('prompt bundle source: labels, snapped positions, validated params', () => {
  const src = sourceFromBundle({
    format: 'prompt-bundle',
    formatVersion: 1,
    title: '任务 #1',
    prompt: 'street, {rain}',
    negativePrompt: 'lowres',
    characters: [
      {
        label: '左',
        prompt: 'red hair',
        negativePrompt: 'bad hands',
        x: 0.28,
        y: 0.52,
      },
      { label: '', prompt: 'blue hair', negativePrompt: '', x: null, y: null },
    ],
    params: { width: 832, height: 99999, model: ' nai ', seed: 3 },
  })
  assert.deepEqual(src.params, { width: 832, model: 'nai', seed: 3 })
  assert.match(src.notes[0], /高 99999 超出范围/)
  const plan = planFromSource(src, lookup)
  assert.deepEqual(plan.characters.map((c) => [c.label, c.position]), [
    ['左', { x: 0.3, y: 0.5 }],
    ['', null],
  ])
  assert.equal(plan.negative, 'lowres, bad hands')
  const next = applySceneImport(
    emptySceneContent('t'),
    plan,
    new Set(['content', 'characters', 'negative', 'params'] as const),
    'append',
  )
  assert.deepEqual(next.slots.map((s) => s.label), ['左', ''])
  assert.deepEqual(next.content.items.map((i) => i.source.kind), [
    'text',
    'catalog',
  ])
  assert.deepEqual(next.params, { width: 832, model: 'nai', seed: 3 })
})
