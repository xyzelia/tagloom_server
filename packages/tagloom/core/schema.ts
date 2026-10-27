// 人物内容的 zod 校验（保存和导入人物存档时使用）。结构定义在 share/model.ts，这里保证两者一致。
import { z } from 'zod'
import {
  BASE_SEGMENT_KEYS,
  type CharacterContent,
  COMBO_SEGMENT_KEYS,
  MAX_CHARACTER_STATES,
  MAX_SCENE_SLOTS,
  SCENE_PARAM_LIMITS,
  SCENE_PARAM_TEXT_MAX,
  type SceneContent,
  type SceneNumberParam,
  SNAPSHOT_PARTS,
  type SnapshotPart,
  STATE_OVERRIDE_TARGETS,
  type StateOverrideTarget,
} from '../share/mod.ts'

const id = z.string().min(1).max(64)
const text = (max: number) => z.string().max(max)
const decision = z.enum(['pending', 'confirmed', 'rejected'])
const match = z.enum([
  'canonical',
  'alias',
  'label',
  'partial',
  'none',
  'manual',
])
// epoch 毫秒
const timestamp = z.number().int().nonnegative()

const originInfo = {
  origin: z.enum(['user', 'agent']),
  agentName: text(200),
  createdAt: timestamp,
}

const tagRef = z.object({
  canonical: text(500).min(1),
  labelZh: text(500),
  categoryPath: text(500),
  catalogVersion: text(200).nullable(),
})

const candidate = z.object({
  id,
  tags: z.array(tagRef).max(50),
  match,
  evidence: text(500),
  reason: text(2000),
  decision,
})

const fact = z.object({
  id,
  field: text(100),
  text: text(2000),
  sourceQuote: text(2000),
  status: decision,
  locked: z.boolean(),
  candidates: z.array(candidate).max(200),
  searchedAt: timestamp.nullable(),
  searchVerified: z.boolean(),
})

const item = z.object({
  id,
  ...originInfo,
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('catalog'), tag: tagRef }),
    z.object({ kind: z.literal('custom'), customId: id }),
    z.object({ kind: z.literal('text') }),
  ]),
  field: text(100).nullable(),
  text: text(5000),
  included: z.boolean(),
  factId: id.nullable(),
})

const segment = z.object({
  items: z.array(item).max(500),
  facts: z.array(fact).max(500),
  fieldStates: z.record(z.string().max(100), z.enum(['open', 'na'])),
})

const customTag = z.object({
  id,
  ...originInfo,
  text: text(2000).min(1),
  label: text(500),
  fields: z.array(text(100)).max(100),
  note: text(2000),
})

const seed = z.number().int().min(0).max(0xffff_ffff)

const stateOverride = z.object({
  mode: z.enum(['append', 'replace']),
  content: segment,
})

// 只允许 base.<分类> / costume.<分类> 目标；未知目标直接拒绝
const stateOverrides = z.object(
  Object.fromEntries(
    STATE_OVERRIDE_TARGETS.map((t) => [t, stateOverride.optional()]),
  ) as Record<StateOverrideTarget, z.ZodOptional<typeof stateOverride>>,
).strict()

const characterState = z.object({
  id,
  name: text(200),
  note: text(2000),
  expression: segment,
  action: segment,
  overrides: stateOverrides,
  seed: seed.optional(),
})

export const characterContentSchema = z.object({
  title: text(200),
  profile: text(200_000),
  // 兼容增加此字段前的人物文件和 v2 存档；保留手写原文，不 trim。
  stylePrompt: text(200_000).default(''),
  // 同上：兼容增加此字段前的文件和存档
  negativePrompt: text(200_000).default(''),
  seed: seed.optional(),
  customTags: z.array(customTag).max(1000),
  base: z.object({
    subject: text(200),
    segments: z.record(z.enum(BASE_SEGMENT_KEYS), segment),
  }),
  combos: z.array(z.object({
    id,
    name: text(200),
    segments: z.record(z.enum(COMBO_SEGMENT_KEYS), segment),
    hairOverride: z.object({ enabled: z.boolean(), segment }),
    // 兼容增加状态前的 v2 存档与人物文件
    states: z.array(characterState).max(MAX_CHARACTER_STATES).default([]),
  })).max(100),
})

// 编译期检查：zod 推导的类型与 share 的类型一致
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _contentMatches: Same<
  z.infer<typeof characterContentSchema>,
  CharacterContent
> = true
void _contentMatches

// ---- 场景（share/scene.ts）----
// 场景条目不分类：field 恒为 null，没有事实和字段状态；自创标签不限字段

const sceneItem = item.extend({ field: z.null() })

const sceneSegment = z.object({
  items: z.array(sceneItem).max(500),
  facts: z.array(fact).max(0),
  fieldStates: z.record(z.string().max(100), z.enum(['open', 'na'])).refine(
    (v) => Object.keys(v).length === 0,
    '场景条目没有字段状态',
  ),
})

const sceneCustomTag = customTag.extend({ fields: z.array(text(100)).max(0) })

const snapshotText = text(200_000)

const slotSnapshot = z.object({
  characterPath: text(2000),
  title: text(200),
  comboId: id,
  comboName: text(200),
  stateId: id.nullable(),
  stateName: text(200),
  takenAt: timestamp,
  subject: text(200),
  base: snapshotText,
  costume: snapshotText,
  expression: snapshotText,
  action: snapshotText,
  negative: snapshotText,
  use: z.object(
    Object.fromEntries(SNAPSHOT_PARTS.map((k) => [k, z.boolean()])) as Record<
      SnapshotPart,
      z.ZodBoolean
    >,
  ),
})

const unit = z.number().min(0).max(1)

// 生成参数只做宽松的取值范围检查（share 的 SCENE_PARAM_LIMITS），是否被生成端支持由生成端判断
const paramNumber = (k: SceneNumberParam) => {
  const r = SCENE_PARAM_LIMITS[k]
  const n = z.number().min(r.min).max(r.max)
  return (r.int ? n.int() : n).optional()
}
const paramText = text(SCENE_PARAM_TEXT_MAX).optional()
const sceneParams = z.object({
  model: paramText,
  width: paramNumber('width'),
  height: paramNumber('height'),
  steps: paramNumber('steps'),
  scale: paramNumber('scale'),
  cfgRescale: paramNumber('cfgRescale'),
  sampler: paramText,
  noiseSchedule: paramText,
  seed: paramNumber('seed'),
}).strict()

export const sceneContentSchema = z.object({
  title: text(200),
  note: text(20_000),
  content: sceneSegment,
  negativePrompt: text(200_000),
  customTags: z.array(sceneCustomTag).max(1000),
  slots: z.array(z.object({
    id,
    label: text(200),
    snapshot: slotSnapshot.nullable(),
    extra: sceneSegment,
    position: z.object({ x: unit, y: unit }).nullable(),
  })).max(MAX_SCENE_SLOTS),
  params: sceneParams.optional(),
})

// 场景条目比 Segment 更严（field 只能是 null），只检查推导类型能当作 SceneContent 用
const _sceneMatches: z.infer<typeof sceneContentSchema> extends SceneContent
  ? true
  : false = true
void _sceneMatches
