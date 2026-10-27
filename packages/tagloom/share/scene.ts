// 场景：组合各种 tag 得到一份多角色 Prompt（设计见 doc/SCENES_DESIGN.md）。只有类型和纯函数，前端可直接 import。
// 原则：
// - 主要存提示词内容；不存画风串。生成参数（尺寸、种子等）可选填，用于复现，不填由生成端决定。
// - 场景自有内容不分类：一个有序条目列表（词库 tag / 场景自创标签 / 自由文本）。
// - 人物 = 一次性快照：导入时把「人物 + 组合 + 状态」组装成分段文本存进槽位，之后与人物文件无关。
//   要换表情 / 状态就重新选择，整份快照覆盖；槽位的补充（extra）和位置属于场景，换快照不丢。
import {
  assembleCombo,
  joinSegments,
  negativeText,
  segmentText,
} from './assemble.ts'
import {
  type Character,
  type CharacterContent,
  type CustomTag,
  displayTitle,
  emptySegment,
  newId,
  type Segment,
} from './model.ts'
import {
  PROMPT_BUNDLE_FORMAT,
  PROMPT_BUNDLE_VERSION,
  type PromptBundle,
} from '@app/shared/prompt-bundle'
import { customTagUsageIn } from './custom-tags.ts'
import { SCENE_OUTPUT_FORMAT, SCENE_OUTPUT_FORMAT_VERSION } from './formats.ts'

// 对应 NovelAI V4 多角色上限（待核实）
export const MAX_SCENE_SLOTS = 6

export const SNAPSHOT_PARTS = [
  'subject',
  'base',
  'costume',
  'expression',
  'action',
  'negative',
] as const
export type SnapshotPart = typeof SNAPSHOT_PARTS[number]

export const SNAPSHOT_PART_LABEL: Record<SnapshotPart, string> = {
  subject: '主体',
  base: 'Base',
  costume: '服装',
  expression: '神态与表情',
  action: '动作与姿势',
  negative: '负面',
}

export interface SlotSnapshot {
  // 来源记录：只用于界面显示和「重新选择」时默认定位，不再回读
  characterPath: string
  title: string
  comboId: string
  comboName: string
  // null = 不使用状态
  stateId: string | null
  stateName: string
  takenAt: number
  // 组装结果（状态 overrides 与组合发型覆盖已应用）
  subject: string
  base: string
  costume: string
  expression: string
  action: string
  negative: string
  // 分段输出开关；关掉某段不需要重新导入
  use: Record<SnapshotPart, boolean>
}

export interface SlotPosition {
  x: number
  y: number
}

export interface CharacterSlot {
  // 槽位身份，重新选择人物 / 状态时不变
  id: string
  label: string
  // null = 不来自 tagloom 人物（纯手写）
  snapshot: SlotSnapshot | null
  // 场景对此人物的补充（本场景的表情、动作、视线、手持物……），换快照不丢
  extra: Segment
  // 0..1；null = 不指定
  position: SlotPosition | null
}

export interface Scene {
  path: string
  // 每次保存加 1，用于防止覆盖别处的修改
  version: number
  createdAt: number
  updatedAt: number
  title: string
  note: string
  // 场景自有条目（不分类，条目 field 恒为 null）
  content: Segment
  // 手写原文
  negativePrompt: string
  // 场景自创标签库，content 与各槽位 extra 共用
  customTags: CustomTag[]
  // 有序，顺序即输出 characters[] 的顺序
  slots: CharacterSlot[]
  // 可选的生成参数；没有这个键 = 都不指定（旧文件也没有）
  params?: SceneParams
}

// 生成参数：每项都可选，没填的由生成端（模板 / 默认值）决定。
// 字段名与 novelai 表单一致，导出时原样带出；tagloom 只存不校验取值是否被生成端支持。
export interface SceneParams {
  model?: string
  width?: number
  height?: number
  steps?: number
  scale?: number
  cfgRescale?: number
  sampler?: string
  noiseSchedule?: string
  seed?: number
}

export const SCENE_PARAM_KEYS = [
  'model',
  'width',
  'height',
  'steps',
  'scale',
  'cfgRescale',
  'sampler',
  'noiseSchedule',
  'seed',
] as const satisfies readonly (keyof SceneParams)[]

export const SCENE_PARAM_LABEL: Record<keyof SceneParams, string> = {
  model: '模型',
  width: '宽',
  height: '高',
  steps: '步数',
  scale: 'CFG',
  cfgRescale: 'CFG Rescale',
  sampler: '采样器',
  noiseSchedule: '噪声调度',
  seed: '种子',
}

export type SceneNumberParam =
  | 'width'
  | 'height'
  | 'steps'
  | 'scale'
  | 'cfgRescale'
  | 'seed'
export type SceneTextParam = 'model' | 'sampler' | 'noiseSchedule'

// 取值范围：服务端 schema、编辑框、图片导入共用
export const SCENE_PARAM_LIMITS: Record<
  SceneNumberParam,
  { min: number; max: number; int: boolean }
> = {
  width: { min: 1, max: 16384, int: true },
  height: { min: 1, max: 16384, int: true },
  steps: { min: 1, max: 1000, int: true },
  scale: { min: 0, max: 100, int: false },
  cfgRescale: { min: 0, max: 1, int: false },
  seed: { min: 0, max: 0xffff_ffff, int: true },
}
export const SCENE_PARAM_TEXT_MAX = 200

export function isValidSceneParam(
  k: SceneNumberParam,
  v: unknown,
): v is number {
  const r = SCENE_PARAM_LIMITS[k]
  return typeof v === 'number' && Number.isFinite(v) &&
    (!r.int || Number.isInteger(v)) && v >= r.min && v <= r.max
}

// 去掉没填的项（undefined、空字符串）；一项都没有时返回 undefined
export function cleanSceneParams(
  p: SceneParams | undefined,
): SceneParams | undefined {
  if (!p) return undefined
  const out: Record<string, string | number> = {}
  for (const k of SCENE_PARAM_KEYS) {
    const v = p[k]
    if (typeof v === 'string' ? v.trim() : v !== undefined) {
      out[k] = typeof v === 'string' ? v.trim() : v as number
    }
  }
  return Object.keys(out).length ? out as SceneParams : undefined
}

// 客户端可编辑的部分（路径、版本、时间由服务端维护）
export type SceneContent = Pick<
  Scene,
  | 'title'
  | 'note'
  | 'content'
  | 'negativePrompt'
  | 'customTags'
  | 'slots'
  | 'params'
>

export function sceneContentOf(s: Scene): SceneContent {
  return {
    title: s.title,
    note: s.note,
    content: s.content,
    negativePrompt: s.negativePrompt,
    customTags: s.customTags,
    slots: s.slots,
    ...(s.params ? { params: s.params } : {}),
  }
}

export function emptySceneContent(title = ''): SceneContent {
  return {
    title,
    note: '',
    content: emptySegment(),
    negativePrompt: '',
    customTags: [],
    slots: [],
  }
}

export function emptySlot(label = ''): CharacterSlot {
  return {
    id: newId(),
    label,
    snapshot: null,
    extra: emptySegment(),
    position: null,
  }
}

export function sceneDisplayTitle(s: Pick<Scene, 'title'>): string {
  return s.title.trim() || '未命名场景'
}

const ALL_PARTS_ON: Record<SnapshotPart, boolean> = {
  subject: true,
  base: true,
  costume: true,
  expression: true,
  action: true,
  negative: true,
}

// 由人物生成快照；组合不存在返回 null。stateId 找不到时按「不使用状态」处理
export function buildSlotSnapshot(
  c:
    & Pick<CharacterContent, 'title' | 'profile' | 'base' | 'combos'>
    & Pick<Character, 'negativePrompt' | 'seed'>,
  characterPath: string,
  comboId: string,
  stateId: string | null,
  now: number,
): SlotSnapshot | null {
  const combo = c.combos.find((x) => x.id === comboId)
  if (!combo) return null
  const state = stateId
    ? (combo.states ?? []).find((s) => s.id === stateId) ?? null
    : null
  const a = assembleCombo(c, combo, state)
  return {
    characterPath,
    title: displayTitle(c),
    comboId: combo.id,
    comboName: combo.name,
    stateId: state?.id ?? null,
    stateName: state?.name ?? '',
    takenAt: now,
    subject: c.base.subject.trim(),
    base: a.base,
    costume: a.costume,
    expression: a.state?.expression ?? '',
    action: a.state?.action ?? '',
    negative: negativeText(c),
    use: { ...ALL_PARTS_ON },
  }
}

// 重新选择：整份快照覆盖，分段开关沿用旧值
export function replaceSnapshot(
  slot: CharacterSlot,
  next: SlotSnapshot,
): CharacterSlot {
  return {
    ...slot,
    snapshot: slot.snapshot ? { ...next, use: { ...slot.snapshot.use } } : next,
  }
}

// 「复制以改写」：把快照某段文本复制成 extra 的一条自由文本条目，并关掉该段的输出
export function snapshotPartToExtra(
  slot: CharacterSlot,
  part: Exclude<SnapshotPart, 'negative'>,
  by: Pick<CustomTag, 'origin' | 'agentName' | 'createdAt'>,
): CharacterSlot {
  const snap = slot.snapshot
  if (!snap || !snap[part]) return slot
  return {
    ...slot,
    snapshot: { ...snap, use: { ...snap.use, [part]: false } },
    extra: {
      ...slot.extra,
      items: [...slot.extra.items, {
        ...by,
        id: newId(),
        source: { kind: 'text' },
        field: null,
        text: snap[part],
        included: true,
        factId: null,
      }],
    },
  }
}

// 一个人物槽位的 Prompt：快照中开启的段（主体 → Base → 服装 → 表情 → 动作）+ 补充
export function slotPrompt(slot: CharacterSlot): string {
  const s = slot.snapshot
  const parts = s
    ? (['subject', 'base', 'costume', 'expression', 'action'] as const)
      .filter((k) => s.use[k])
      .map((k) => s[k])
    : []
  return joinSegments([...parts, segmentText(slot.extra)])
}

export function slotNegative(slot: CharacterSlot): string {
  const s = slot.snapshot
  return s && s.use.negative ? s.negative : ''
}

export function scenePrompt(s: Pick<SceneContent, 'content'>): string {
  return segmentText(s.content)
}

export function sceneNegative(s: Pick<SceneContent, 'negativePrompt'>): string {
  return negativeText(s)
}

export function slotDisplayLabel(slot: CharacterSlot, index: number): string {
  return slot.label.trim() || slot.snapshot?.title || `人物 ${index + 1}`
}

// 场景所有条目所在的位置：场景内容 + 各槽位补充
export function sceneSegments(s: Pick<SceneContent, 'content' | 'slots'>) {
  return [s.content, ...s.slots.map((x) => x.extra)]
}

export function sceneCustomTagUsage(
  s: Pick<SceneContent, 'content' | 'slots'>,
): Map<string, number> {
  return customTagUsageIn(sceneSegments(s))
}

// 下游成品：与 novelai 请求的 prompt / negativePrompt / characters[] 及表单参数对应（不依赖 novelai）
export interface SceneOutput {
  format: typeof SCENE_OUTPUT_FORMAT
  formatVersion: number
  exportedAt: number
  // 导出时的场景版本，便于对照
  sourceVersion: number
  title: string
  prompt: string
  negativePrompt: string
  characters: {
    label: string
    prompt: string
    negativePrompt: string
    x: number | null
    y: number | null
  }[]
  // 只含填了的项；一项都没填时为空对象
  params: SceneParams
}

export function buildSceneOutput(s: Scene, now: number): SceneOutput {
  return {
    format: SCENE_OUTPUT_FORMAT,
    formatVersion: SCENE_OUTPUT_FORMAT_VERSION,
    exportedAt: now,
    sourceVersion: s.version,
    title: sceneDisplayTitle(s),
    prompt: scenePrompt(s),
    negativePrompt: sceneNegative(s),
    characters: s.slots.map((slot, i) => ({
      label: slotDisplayLabel(slot, i),
      prompt: slotPrompt(slot),
      negativePrompt: slotNegative(slot),
      x: slot.position?.x ?? null,
      y: slot.position?.y ?? null,
    })),
    params: cleanSceneParams(s.params) ?? {},
  }
}

// 发给其他模块的中立格式（@app/shared/prompt-bundle）；用编辑中的内容，不要求先保存
export function buildPromptBundle(s: SceneContent): PromptBundle {
  return {
    format: PROMPT_BUNDLE_FORMAT,
    formatVersion: PROMPT_BUNDLE_VERSION,
    title: sceneDisplayTitle(s),
    prompt: scenePrompt(s),
    negativePrompt: sceneNegative(s),
    characters: s.slots.map((slot, i) => ({
      label: slotDisplayLabel(slot, i),
      prompt: slotPrompt(slot),
      negativePrompt: slotNegative(slot),
      x: slot.position?.x ?? null,
      y: slot.position?.y ?? null,
    })),
    params: cleanSceneParams(s.params) ?? {},
  }
}

// 单个人物发给其他模块：主 Prompt 留空，人物作为唯一一个角色（不指定位置），
// 内容和导入场景快照完全一样（同一组合 + 状态）；人物默认种子放进参数。组合不存在时返回 null
export function buildCharacterBundle(
  c: CharacterContent,
  comboId: string,
  stateId: string | null,
): PromptBundle | null {
  const snapshot = buildSlotSnapshot(c, '', comboId, stateId, 0)
  if (!snapshot) return null
  const slot = { ...emptySlot(), snapshot }
  const parts = [snapshot.title, snapshot.comboName || '未命名组合']
  if (snapshot.stateId) parts.push(snapshot.stateName || '未命名状态')
  return {
    format: PROMPT_BUNDLE_FORMAT,
    formatVersion: PROMPT_BUNDLE_VERSION,
    title: parts.join(' / '),
    prompt: '',
    negativePrompt: '',
    characters: [{
      label: snapshot.title,
      prompt: slotPrompt(slot),
      negativePrompt: slotNegative(slot),
      x: null,
      y: null,
    }],
    params: c.seed === undefined ? {} : { seed: c.seed },
  }
}

export function buildSceneText(s: SceneContent): string {
  const lines: string[] = [`# ${sceneDisplayTitle(s)}`, '', '## Prompt']
  lines.push(scenePrompt(s))
  if (sceneNegative(s)) lines.push(`Negative: ${sceneNegative(s)}`)
  s.slots.forEach((slot, i) => {
    lines.push('', `## ${slotDisplayLabel(slot, i)}`)
    if (slot.snapshot) {
      const snap = slot.snapshot
      lines.push(
        `From: ${snap.title} / ${snap.comboName || '未命名组合'}${
          snap.stateId ? ` / ${snap.stateName || '未命名状态'}` : ''
        }`,
      )
    }
    if (slot.position) {
      lines.push(`Position: ${slot.position.x}, ${slot.position.y}`)
    }
    lines.push(`Prompt: ${slotPrompt(slot)}`)
    if (slotNegative(slot)) lines.push(`Negative: ${slotNegative(slot)}`)
  })
  const params = cleanSceneParams(s.params)
  if (params) {
    lines.push('', '## Parameters')
    for (const k of SCENE_PARAM_KEYS) {
      if (params[k] !== undefined) lines.push(`${k}: ${params[k]}`)
    }
  }
  return lines.join('\n') + '\n'
}
