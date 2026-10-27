// 人物的数据结构（人物存档即这个结构）。只有类型和纯函数，不依赖 zod，前端可直接 import。
// 原则：
// - 每个分类的最终 Prompt 是一个有序条目列表（词库 tag / 自创标签 / 自由文本），每条可开关是否输出、可改写法和权重；
//   输出 = 勾选的条目按顺序用逗号连接。条目保留来源（词库快照或自创标签 id），文本由用户决定。
// - 自创标签存在人物自己的标签库里（customTags），人工或 AI 都可以创建，并记录创建来源。
// - 字段值状态、匹配依据、确认状态、锁定是独立的维度。
import {
  BASE_SEGMENT_KEYS,
  type BaseSegmentKey,
  COMBO_SEGMENT_KEYS,
  type ComboSegmentKey,
  type StateOverrideTarget,
} from './fields.ts'
import type { AgentChange } from './agent.ts'

// 字段值状态：只保存用户明确设定的 OPEN（不固定）/ N/A（不适用）；没有记录就是「未填写」
export type FieldState = 'open' | 'na'

// 匹配依据：词库命中方式。manual = 用户从分类列表里直接手选，不是检索命中
export type MatchKind =
  | 'canonical'
  | 'alias'
  | 'label'
  | 'partial'
  | 'none'
  | 'manual'

// 确认状态（事实与候选共用）
export type Decision = 'pending' | 'confirmed' | 'rejected'

// 创建 / 添加来源：人工或 AI agent
export type Origin = 'user' | 'agent'

export interface OriginInfo {
  origin: Origin
  // origin = agent 时记录是哪个 agent / 模型（可空）
  agentName: string
  // 时间一律为 epoch 毫秒；时区只在前端显示时处理
  createdAt: number
}

// 标签引用：保存选择时的 canonical 快照与词库版本，不依赖会随重建变化的数字 id
export interface TagRef {
  canonical: string
  labelZh: string
  categoryPath: string
  // 选择时的词库版本；null = 没有经过数据库核查（如词库不可用）
  catalogVersion: string | null
}

// 自创标签：针对这个角色的自定义表达（词库没有或不贴切时用），存在人物 JSON 里，Base 与各组合共用
export interface CustomTag extends OriginInfo {
  id: string
  // 写进 Prompt 的原文，可以带权重
  text: string
  // 中文说明
  label: string
  // 建议归属的选词字段；空数组 = 所有字段都显示
  fields: string[]
  note: string
}

export type ItemSource =
  | { kind: 'catalog'; tag: TagRef }
  // 选用时复制标签文本；之后修改标签库不会静默改变已在用的条目
  | { kind: 'custom'; customId: string }
  | { kind: 'text' }

// 最终 Prompt 的一个条目
export interface PromptItem extends OriginInfo {
  id: string
  source: ItemSource
  // 所属选词字段（文本条目可为 null）
  field: string | null
  // 输出的文本（可改写、加权重）
  text: string
  // 是否加入最终 Prompt；不勾选 = 保留为已选但不输出
  included: boolean
  // 通过确认某个事实的候选加入时记下来源
  factId: string | null
}

// 候选：一个可审核的表达方案，可以包含多个标签
export interface Candidate {
  id: string
  tags: TagRef[]
  match: MatchKind
  // 命中的词（canonical / 别名 / 中文名称）
  evidence: string
  reason: string
  decision: Decision
}

// 人物事实：一条可检查、可编辑的设定（如「蓝色牛仔裤」），与命中强度、确认、锁定分开
export interface Fact {
  id: string
  field: string
  text: string
  // 从角色档案摘录的原文片段；档案修改后不再包含它时提示「提取依据已变化」
  sourceQuote: string
  status: Decision
  // 锁定：重新检索等自动操作不改写该事实及其候选
  locked: boolean
  candidates: Candidate[]
  // 最近一次检索：时间与是否经过数据库核查
  searchedAt: number | null
  searchVerified: boolean
}

// 一个分类：最终 Prompt 条目 + 事实 + 字段状态
export interface Segment {
  items: PromptItem[]
  facts: Fact[]
  fieldStates: Record<string, FieldState>
}

export interface Base {
  // 主体类型（如 1girl），可选；如何放进最终请求由导出目标决定，不混入身形
  subject: string
  segments: Record<BaseSegmentKey, Segment>
}

export const MAX_CHARACTER_STATES = 200

// 状态覆盖模式：'append' 保留原造型并补充，'replace' 改用本状态内容（空内容即不输出）
export type StateOverrideMode = 'append' | 'replace'

export interface StateOverride {
  mode: StateOverrideMode
  content: Segment
}

// 角色状态：连接表情、动作与造型调整的一体化实体，属于特定造型组合
export interface CharacterState {
  id: string
  name: string
  note: string
  expression: Segment
  action: Segment
  // 覆盖目标为 base.<BaseSegmentKey> 或 costume.<ComboSegmentKey>
  overrides: Partial<Record<StateOverrideTarget, StateOverride>>
  // 状态可选指定种子（0..2^32-1）；缺省则沿用人物种子
  seed?: number
}

export interface Combo {
  id: string
  // 用户填写的场合名称；可以为空
  name: string
  segments: Record<ComboSegmentKey, Segment>
  // 未启用沿用 Base 头发；启用后直接使用覆盖段，不叠加旧发型
  hairOverride: { enabled: boolean; segment: Segment }
  // 该造型组合下的所有角色状态
  states: CharacterState[]
}

export interface Character {
  // 人物文件在 characters/ 下的相对路径，即人物的身份（见 share/paths.ts）。
  // 只在读取时由服务端填入，不写进文件，也不进人物存档。
  path: string
  // 每次保存加 1，用于防止覆盖别处的修改
  version: number
  // 人物名（技术元数据，可空；列表里为空时显示档案第一行）
  title: string
  // 角色档案：一个自由文本字符串，默认只存档，不自动改写 Base、不进入 Prompt
  profile: string
  // 人物自己的手写画风串：只记录，不自动解析或拼入角色 Prompt
  stylePrompt: string
  // 负面 Prompt：希望避免出现的内容，手写原文、不分类；导出时原样作为负面提示词（只去掉首尾的空白和逗号）
  negativePrompt: string
  // 人物默认种子（0..2^32-1，可选）
  seed?: number
  // 角色标签库（自创标签）
  customTags: CustomTag[]
  base: Base
  combos: Combo[]
  createdAt: number
  updatedAt: number
  // 最近一次由用户（编辑页）保存时的版本号；之后的版本都来自 AI 追加
  userVersion: number
  // 自上次用户保存以来的 AI 变更（用户保存成功后清空）；用于编辑页拉取合并和保存时自动合并
  agentChanges: AgentChange[]
}

// 客户端可编辑的部分（路径、版本、时间由服务端维护）
export type CharacterContent = Pick<
  Character,
  | 'title'
  | 'profile'
  | 'stylePrompt'
  | 'negativePrompt'
  | 'seed'
  | 'customTags'
  | 'base'
  | 'combos'
>

// 取出可编辑的内容部分
export function contentOf(c: Character): CharacterContent {
  return {
    title: c.title,
    profile: c.profile,
    stylePrompt: c.stylePrompt ?? '',
    negativePrompt: c.negativePrompt ?? '',
    seed: c.seed,
    customTags: c.customTags,
    base: c.base,
    combos: (c.combos ?? []).map((combo) => ({
      ...combo,
      states: combo.states ?? [],
    })),
  }
}

// 前端在非安全上下文（内网 http）没有 crypto.randomUUID，用时间 + 随机数
export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export const nowMs = () => Date.now()

export function userOrigin(now = nowMs()): OriginInfo {
  return { origin: 'user', agentName: '', createdAt: now }
}

export function emptySegment(): Segment {
  return { items: [], facts: [], fieldStates: {} }
}

export function emptyState(name = ''): CharacterState {
  return {
    id: newId(),
    name,
    note: '',
    expression: emptySegment(),
    action: emptySegment(),
    overrides: {},
  }
}

export function emptyBase(): Base {
  return {
    subject: '',
    segments: Object.fromEntries(
      BASE_SEGMENT_KEYS.map((k) => [k, emptySegment()]),
    ) as Record<BaseSegmentKey, Segment>,
  }
}

export function emptyCombo(name = ''): Combo {
  return {
    id: newId(),
    name,
    segments: Object.fromEntries(
      COMBO_SEGMENT_KEYS.map((k) => [k, emptySegment()]),
    ) as Record<ComboSegmentKey, Segment>,
    hairOverride: { enabled: false, segment: emptySegment() },
    states: [],
  }
}

export function emptyContent(): CharacterContent {
  return {
    title: '',
    profile: '',
    stylePrompt: '',
    negativePrompt: '',
    customTags: [],
    base: emptyBase(),
    combos: [emptyCombo('日常')],
  }
}

// 列表显示名：人物名，否则档案第一行
export function displayTitle(c: Pick<Character, 'title' | 'profile'>): string {
  const t = c.title.trim()
  if (t) return t
  const line = c.profile.split('\n').map((l) => l.trim()).find(Boolean)
  return line ? line.slice(0, 40) : '未命名人物'
}

// 复制分类（新 id），用于「用 Base 头发段作为起点」等
export function cloneSegment(seg: Segment): Segment {
  const copy = structuredClone(seg)
  const factIdMap = new Map<string, string>()
  const facts = copy.facts.map((f) => {
    const nid = newId()
    factIdMap.set(f.id, nid)
    return {
      ...f,
      id: nid,
      candidates: f.candidates.map((c) => ({ ...c, id: newId() })),
    }
  })
  const items = copy.items.map((i) => ({
    ...i,
    id: newId(),
    factId: i.factId ? (factIdMap.get(i.factId) ?? null) : null,
  }))
  return {
    ...copy,
    items,
    facts,
    fieldStates: { ...copy.fieldStates },
  }
}

// 复制状态：新 id，独立条目与覆盖段
export function duplicateState(
  state: CharacterState,
  name = `${state.name || '状态'} 副本`,
): CharacterState {
  const copy = structuredClone(state)
  const clonedOverrides: CharacterState['overrides'] = {}
  for (
    const [k, v] of Object.entries(copy.overrides ?? {}) as [
      StateOverrideTarget,
      StateOverride,
    ][]
  ) {
    clonedOverrides[k] = {
      mode: v.mode,
      content: cloneSegment(v.content),
    }
  }
  return {
    ...copy,
    id: newId(),
    name,
    expression: cloneSegment(copy.expression),
    action: cloneSegment(copy.action),
    overrides: clonedOverrides,
    seed: copy.seed,
  }
}

// 复制组合：新 id，内容深拷贝，状态独立复制
export function duplicateCombo(combo: Combo, name: string): Combo {
  const copy = structuredClone(combo)
  return {
    ...copy,
    id: newId(),
    name,
    segments: Object.fromEntries(
      Object.entries(copy.segments).map(([k, s]) => [k, cloneSegment(s)]),
    ) as Record<ComboSegmentKey, Segment>,
    hairOverride: {
      ...copy.hairOverride,
      segment: cloneSegment(copy.hairOverride.segment),
    },
    states: (copy.states ?? []).map((s) => duplicateState(s, s.name)),
  }
}

export const ORIGIN_LABEL: Record<Origin, string> = {
  user: '👤 人工',
  agent: '🤖 AI',
}
