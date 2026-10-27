// Prompt 汇总（classification-and-output.md §5）：
//   头发段 = Base 头发最终段，或当前组合启用发型覆盖后的覆盖段（直接替换，不叠加）
//   有效 Base = 头发 + 眼睛 + 身形 + 其他
//   服装 Prompt = 整体服装补充 + 上装 + 下装 + 外套 + 腿装 + 鞋 + 配饰 + 已填可选服装分类
//   完整角色 Prompt = 有效 Base + 服装 Prompt (+ 状态神态/表情 + 状态动作/姿势)
// 每个分类的文本 = 勾选的条目按顺序用逗号连接；不去重、不重排、不改写条目原文和权重。
// 唯一的处理是去掉每段首尾的空白和逗号，避免拼出 ", ," 这样的空项。
import {
  BASE_SEGMENTS,
  type BaseSegmentKey,
  COMBO_SEGMENTS,
  type ComboSegmentKey,
  overrideTargetLabel,
} from './fields.ts'
import type {
  Base,
  Character,
  CharacterState,
  Combo,
  Segment,
  StateOverride,
} from './model.ts'

export interface AssembledPart<K extends string = string> {
  key: K
  label: string
  text: string
}

export interface AssembledState {
  stateId: string
  stateName: string
  effectiveSeed?: number
  expression: string
  action: string
  baseParts: AssembledPart<BaseSegmentKey>[]
  costumeParts: AssembledPart<ComboSegmentKey>[]
  base: string
  costume: string
  full: string
}

export interface AssembledCombo {
  comboId: string
  comboName: string
  // 头发段来源
  hairSource: 'base' | 'override' | 'state'
  baseParts: AssembledPart<BaseSegmentKey>[]
  costumeParts: AssembledPart<ComboSegmentKey>[]
  base: string
  costume: string
  full: string
  state?: AssembledState
}

export function cleanSegment(text: string): string {
  return text.replace(/^[\s,，]+|[\s,，]+$/g, '')
}

export function joinSegments(texts: string[]): string {
  return texts.map(cleanSegment).filter(Boolean).join(', ')
}

// 负面 Prompt：手写原文，只去掉首尾的空白和逗号
export function negativeText(c: Pick<Character, 'negativePrompt'>): string {
  return cleanSegment(c.negativePrompt ?? '')
}

// 一个分类的输出文本：勾选的条目按顺序连接
export function segmentText(seg: Segment): string {
  return joinSegments(seg.items.filter((i) => i.included).map((i) => i.text))
}

// 只读输出投影：沿用/替换时共享原段引用，调用方不可修改或存回此结果。
// absent = 沿用父级；append = 父级条目 + 状态条目；replace = 仅状态条目（即使空也是清除）
export function resolveEffectiveSegment(
  parentSeg: Segment,
  override?: StateOverride,
): Segment {
  if (!override) return parentSeg
  if (override.mode === 'replace') return override.content
  if (override.mode === 'append') {
    return {
      items: [...parentSeg.items, ...override.content.items],
      facts: [...parentSeg.facts, ...override.content.facts],
      fieldStates: {
        ...parentSeg.fieldStates,
        ...override.content.fieldStates,
      },
    }
  }
  return parentSeg
}

// 纯函数：计算有效种子。状态未指定种子则沿用人物种子；两者均无则无
export function resolveEffectiveSeed(
  characterSeed?: number,
  stateSeed?: number,
): number | undefined {
  if (stateSeed !== undefined) return stateSeed
  return characterSeed
}

// 纯函数：计算状态下的有效 Base 各分类（Base -> combo hairOverride -> state override）
export function resolveEffectiveBase(
  base: Base,
  combo: Combo,
  state?: CharacterState | null,
): Record<BaseSegmentKey, Segment> {
  const parentHair = combo.hairOverride.enabled
    ? combo.hairOverride.segment
    : base.segments.hair
  return {
    hair: resolveEffectiveSegment(parentHair, state?.overrides?.['base.hair']),
    eyes: resolveEffectiveSegment(
      base.segments.eyes,
      state?.overrides?.['base.eyes'],
    ),
    body: resolveEffectiveSegment(
      base.segments.body,
      state?.overrides?.['base.body'],
    ),
    other: resolveEffectiveSegment(
      base.segments.other,
      state?.overrides?.['base.other'],
    ),
  }
}

// 纯函数：计算状态下的有效服装各分类（combo -> state override）
export function resolveEffectiveCostume(
  combo: Combo,
  state?: CharacterState | null,
): Record<ComboSegmentKey, Segment> {
  const out = {} as Record<ComboSegmentKey, Segment>
  for (const def of COMBO_SEGMENTS) {
    const k = def.key
    out[k] = resolveEffectiveSegment(
      combo.segments[k],
      state?.overrides?.[`costume.${k}`],
    )
  }
  return out
}

function baseParts(
  c: Pick<Character, 'base'>,
  combo: Combo | null,
): { parts: AssembledPart<BaseSegmentKey>[]; hairSource: 'base' | 'override' } {
  const override = combo?.hairOverride.enabled ? combo.hairOverride : null
  const parts = BASE_SEGMENTS.map((def) => ({
    key: def.key,
    label: def.label,
    text: segmentText(
      def.key === 'hair' && override
        ? override.segment
        : c.base.segments[def.key],
    ),
  }))
  return { parts, hairSource: override ? 'override' : 'base' }
}

// 不针对组合的 Base（共享 Base 本身）
export function assembleBase(c: Pick<Character, 'base'>): string {
  return joinSegments(baseParts(c, null).parts.map((p) => p.text))
}

// 纯函数：组装单个状态的提示词与各部分
export function assembleState(
  c: Pick<Character, 'base' | 'seed'>,
  combo: Combo,
  state: CharacterState,
): AssembledState {
  const effBase = resolveEffectiveBase(c.base, combo, state)
  const effCostume = resolveEffectiveCostume(combo, state)
  const effectiveSeed = resolveEffectiveSeed(c.seed, state.seed)

  const baseParts = BASE_SEGMENTS.map((def) => ({
    key: def.key,
    label: def.label,
    text: segmentText(effBase[def.key]),
  }))
  const costumeParts = COMBO_SEGMENTS.map((def) => ({
    key: def.key,
    label: def.label,
    text: segmentText(effCostume[def.key]),
  }))

  const baseText = joinSegments(baseParts.map((p) => p.text))
  const costumeText = joinSegments(costumeParts.map((p) => p.text))
  const expressionText = segmentText(state.expression)
  const actionText = segmentText(state.action)

  // 拼接顺序：resolved Base + resolved outfit + expression + action
  const full = joinSegments([
    baseText,
    costumeText,
    expressionText,
    actionText,
  ])

  return {
    stateId: state.id,
    stateName: state.name,
    effectiveSeed,
    expression: expressionText,
    action: actionText,
    baseParts,
    costumeParts,
    base: baseText,
    costume: costumeText,
    full,
  }
}

export function assembleCombo(
  c: Pick<Character, 'base' | 'seed'>,
  combo: Combo,
  state?: CharacterState | null,
): AssembledCombo {
  if (state) {
    const s = assembleState(c, combo, state)
    const hairSource: AssembledCombo['hairSource'] =
      state.overrides?.['base.hair']
        ? 'state'
        : combo.hairOverride.enabled
        ? 'override'
        : 'base'
    return {
      comboId: combo.id,
      comboName: combo.name,
      hairSource,
      baseParts: s.baseParts,
      costumeParts: s.costumeParts,
      base: s.base,
      costume: s.costume,
      full: s.full,
      state: s,
    }
  }

  const { parts, hairSource } = baseParts(c, combo)
  const costumeParts = COMBO_SEGMENTS.map((def) => ({
    key: def.key,
    label: def.label,
    text: segmentText(combo.segments[def.key]),
  }))
  const base = joinSegments(parts.map((p) => p.text))
  const costume = joinSegments(costumeParts.map((p) => p.text))
  return {
    comboId: combo.id,
    comboName: combo.name,
    hairSource,
    baseParts: parts,
    costumeParts,
    base,
    costume,
    full: joinSegments([base, costume]),
  }
}

// 状态覆盖概览辅助函数
export function overrideModeLabel(
  _target: string,
  override: StateOverride,
): string {
  if (override.mode === 'append') return '补充'
  if (segmentText(override.content).length === 0) return '不输出'
  return '改用'
}

export function stateOverridesSummary(
  overrides: CharacterState['overrides'] = {},
): { count: number; items: string[]; summaryText: string } {
  const entries = Object.entries(overrides) as [string, StateOverride][]
  const count = entries.length
  const items = entries.map(([target, o]) => {
    const label = overrideTargetLabel(target)
    const mode = overrideModeLabel(target, o)
    return `${label}（${mode}）`
  })
  const summaryText = count > 0
    ? `${count} 项调整：${items.join('、')}`
    : '0 项调整'
  return { count, items, summaryText }
}

// 逗号分隔的条目（用于重复提示；不用于改写）
export function promptItems(text: string): string[] {
  return text.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
}
