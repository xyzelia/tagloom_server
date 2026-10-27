// 导入场景：主 Prompt → 场景条目，角色 → 新人物槽位（补充条目 + 名称 + 位置），负面 → 场景负面 Prompt，参数 → 生成参数。
// 来源先转成中立的 SceneImportSource：NovelAI 图片元数据（sourceFromNovelaiMeta）或 Prompt 包（sourceFromBundle，来自暂存区）。
// 每条按顶层逗号拆开；标签本身（去掉权重写法）在词库里查到就做成词库条目，文字保留原样（含权重），查不到就是文本条目。
// 图片的生成参数取自 Comment（尺寸、种子、步数、CFG、采样器、噪声调度）；图片里的模型只有描述，对应不到模型 id，不导入。
// 纯函数：词库查询结果由调用方传入。
import {
  type NovelaiImageMeta,
  promptCore,
  splitPrompt,
} from '@app/shared/novelai'
import type { PromptBundle } from '@app/shared/prompt-bundle'
import {
  emptySegment,
  type OriginInfo,
  type Segment,
  type TagRef,
  userOrigin,
} from './model.ts'
import {
  type CharacterSlot,
  cleanSceneParams,
  emptySlot,
  isValidSceneParam,
  MAX_SCENE_SLOTS,
  SCENE_PARAM_LABEL,
  SCENE_PARAM_TEXT_MAX,
  type SceneContent,
  type SceneNumberParam,
  type SceneParams,
  type SceneTextParam,
  type SlotPosition,
} from './scene.ts'
import { addTextItem, pickCatalogTag, setItemText } from './segment.ts'

export interface ImportPiece {
  // 原文（含权重写法），就是条目的文字
  text: string
  // 查词库用的标签本身；不是单个标签时 null
  core: string | null
  // 词库命中；null = 做成文本条目
  tag: TagRef | null
}

// 中立的导入来源
export interface SceneImportSource {
  prompt: string
  negative: string
  characters: {
    label: string
    prompt: string
    negative: string
    position: SlotPosition | null
  }[]
  // 只含在取值范围内的项
  params: SceneParams
  // 转换时需要提醒的事（参数超出范围等）
  notes: string[]
}

export interface SceneImportPlan {
  content: ImportPiece[]
  // 负面原文，角色负面已并入
  negative: string
  characters: {
    label: string
    pieces: ImportPiece[]
    position: SlotPosition | null
  }[]
  // 只含来源里有、且在取值范围内的项；没有生成参数时为空对象
  params: SceneParams
  // 需要提醒用户的事（角色负面已合并等）
  notes: string[]
}

export type SceneImportGroup =
  | 'content'
  | 'negative'
  | 'characters'
  | 'params'
export type SceneImportMode = 'append' | 'replace'

// 要到词库查询的标签（去重，保持出现顺序）
export function sceneImportCores(src: SceneImportSource): string[] {
  const texts = [src.prompt, ...src.characters.map((c) => c.prompt)]
  const cores = texts.flatMap(splitPrompt).map(promptCore)
  return [...new Set(cores.filter((c): c is string => c !== null))]
}

// 位置吸附到 5 × 5 网格的格子中心（0.1 … 0.9），与人物槽位的网格一致
export function snapToGrid(v: number): number {
  const i = Math.min(4, Math.max(0, Math.round((v - 0.1) / 0.2)))
  return Math.round((0.1 + i * 0.2) * 10) / 10
}

// Comment 里的键 → 场景参数
const COMMENT_NUMBERS: [string, SceneNumberParam][] = [
  ['width', 'width'],
  ['height', 'height'],
  ['steps', 'steps'],
  ['scale', 'scale'],
  ['cfg_rescale', 'cfgRescale'],
  ['seed', 'seed'],
]
const COMMENT_TEXTS: [string, SceneTextParam][] = [
  ['sampler', 'sampler'],
  ['noise_schedule', 'noiseSchedule'],
]

// 超出范围的值不导入（存不进去），给出提醒
export function paramsFromComment(
  comment: Record<string, unknown> | null,
): { params: SceneParams; notes: string[] } {
  const params: SceneParams = {}
  const notes: string[] = []
  if (!comment) return { params, notes }
  for (const [from, to] of COMMENT_NUMBERS) {
    const v = comment[from]
    if (v === undefined || v === null) continue
    if (isValidSceneParam(to, v)) params[to] = v
    else notes.push(`${SCENE_PARAM_LABEL[to]} ${String(v)} 超出范围，不导入。`)
  }
  for (const [from, to] of COMMENT_TEXTS) {
    const v = comment[from]
    if (typeof v === 'string' && v.trim()) {
      params[to] = v.trim().slice(0, SCENE_PARAM_TEXT_MAX)
    }
  }
  return { params, notes }
}

function pieces(text: string, lookup: ReadonlyMap<string, TagRef>) {
  return splitPrompt(text).map((t): ImportPiece => {
    const core = promptCore(t)
    return {
      text: t,
      core,
      tag: core === null ? null : lookup.get(core) ?? null,
    }
  })
}

export function sourceFromNovelaiMeta(
  meta: NovelaiImageMeta,
): SceneImportSource {
  const { params, notes } = paramsFromComment(meta.comment)
  return {
    prompt: meta.prompt,
    negative: meta.negative ?? '',
    characters: (meta.characters ?? []).map((c) => ({
      label: '',
      prompt: c.prompt,
      negative: c.negative,
      // 没开 use_coords 时 NovelAI 也写 0.5,0.5，不算指定位置
      position: meta.useCoords && c.center
        ? { x: snapToGrid(c.center.x), y: snapToGrid(c.center.y) }
        : null,
    })),
    params,
    notes,
  }
}

const BUNDLE_NUMBERS: SceneNumberParam[] = [
  'width',
  'height',
  'steps',
  'scale',
  'cfgRescale',
  'seed',
]
const BUNDLE_TEXTS: SceneTextParam[] = ['model', 'sampler', 'noiseSchedule']

export function sourceFromBundle(b: PromptBundle): SceneImportSource {
  const params: SceneParams = {}
  const notes: string[] = []
  for (const k of BUNDLE_NUMBERS) {
    const v = b.params[k]
    if (v === undefined) continue
    if (isValidSceneParam(k, v)) params[k] = v
    else notes.push(`${SCENE_PARAM_LABEL[k]} ${v} 超出范围，不导入。`)
  }
  for (const k of BUNDLE_TEXTS) {
    const v = b.params[k]?.trim()
    if (v) params[k] = v.slice(0, SCENE_PARAM_TEXT_MAX)
  }
  return {
    prompt: b.prompt,
    negative: b.negativePrompt,
    characters: b.characters.map((c) => ({
      label: c.label.trim().slice(0, 200),
      prompt: c.prompt,
      negative: c.negativePrompt,
      position: c.x !== null && c.y !== null
        ? { x: snapToGrid(c.x), y: snapToGrid(c.y) }
        : null,
    })),
    params,
    notes,
  }
}

export function planSceneImport(
  src: SceneImportSource,
  lookup: ReadonlyMap<string, TagRef>,
): SceneImportPlan {
  const notes: string[] = [...src.notes]
  const charNegatives = src.characters.map((c) => c.negative.trim())
    .filter(Boolean)
  if (charNegatives.length > 0) {
    notes.push(
      `人物槽位没有负面 Prompt：${charNegatives.length} 个角色的负面已并入场景负面 Prompt。`,
    )
  }
  return {
    content: pieces(src.prompt, lookup),
    negative: [src.negative, ...charNegatives]
      .map((s) => s.trim()).filter(Boolean).join(', '),
    characters: src.characters.map((c) => ({
      label: c.label,
      pieces: pieces(c.prompt, lookup),
      position: c.position,
    })),
    params: src.params,
    notes,
  }
}

function addPieces(seg: Segment, list: ImportPiece[], by: OriginInfo) {
  let next = seg
  for (const p of list) {
    if (!p.tag) {
      next = addTextItem(next, p.text, by)
      continue
    }
    const before = next.items.length
    next = pickCatalogTag(next, null, p.tag, by)
    // 新加的条目保留图片里的原文（权重、别名写法）；已有同一标签时只重新勾选
    const added = next.items.length > before ? next.items[before] : null
    if (added && added.text !== p.text) {
      next = setItemText(next, added.id, p.text)
    }
  }
  return next
}

// 这次能放下几个人物
export function slotRoom(c: SceneContent, mode: SceneImportMode): number {
  return mode === 'replace' ? MAX_SCENE_SLOTS : MAX_SCENE_SLOTS - c.slots.length
}

// replace：清空场景条目、负面 Prompt、人物后再导入；勾选了生成参数时参数也整份换成图片里的。
// append：图片里有的参数项覆盖同名项，其余保留。标题、备注、场景标签库都不动。
// 只处理选中的分组；人物超过上限的部分丢掉（界面上提前提示）
export function applySceneImport(
  c: SceneContent,
  plan: SceneImportPlan,
  groups: ReadonlySet<SceneImportGroup>,
  mode: SceneImportMode,
  by: OriginInfo = userOrigin(),
): SceneContent {
  const replace = mode === 'replace'
  const next: SceneContent = {
    ...c,
    content: replace ? emptySegment() : c.content,
    negativePrompt: replace ? '' : c.negativePrompt,
    slots: replace ? [] : c.slots,
  }
  if (groups.has('content')) {
    next.content = addPieces(next.content, plan.content, by)
  }
  if (groups.has('negative') && plan.negative) {
    next.negativePrompt = [next.negativePrompt.trim(), plan.negative]
      .filter(Boolean).join(', ')
  }
  if (groups.has('characters')) {
    const room = slotRoom(c, mode)
    const added: CharacterSlot[] = plan.characters.slice(0, Math.max(0, room))
      .map((ch) => ({
        ...emptySlot(ch.label),
        extra: addPieces(emptySegment(), ch.pieces, by),
        position: ch.position,
      }))
    next.slots = [...next.slots, ...added]
  }
  if (groups.has('params')) {
    const params = cleanSceneParams(
      replace ? plan.params : { ...c.params, ...plan.params },
    )
    delete next.params
    if (params) next.params = params
  }
  return next
}
