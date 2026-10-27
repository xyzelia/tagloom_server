// 状态编辑 UI 的纯函数：种子输入校验、状态增删复制、造型调整（覆盖）操作与摘要。
// 不依赖 React / DOM，便于单元测试。
import {
  type Base,
  type CharacterState,
  cloneSegment,
  type Combo,
  duplicateState,
  emptySegment,
  emptyState,
  overrideModeLabel,
  overrideTargetLabel,
  type Segment,
  STATE_OVERRIDE_TARGETS,
  type StateOverride,
  type StateOverrideMode,
  type StateOverrideTarget,
} from '@app/tagloom/share'

export const SEED_MAX = 4294967295

export type SeedParse =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string }

// 种子输入 → uint32。只接受十进制非负整数文本；0 是有效种子。
// 空串：allowEmpty 时表示“未设置”，否则报错。绝不取整 / 截断 / 产生 NaN。
export function parseSeedInput(text: string, allowEmpty: boolean): SeedParse {
  const t = text.trim()
  if (t === '') {
    return allowEmpty
      ? { ok: true, value: undefined }
      : { ok: false, error: `请输入 0–${SEED_MAX} 的整数种子` }
  }
  if (!/^\d+$/.test(t)) {
    return { ok: false, error: `种子必须是 0–${SEED_MAX} 的非负整数` }
  }
  const n = Number(t)
  if (!Number.isSafeInteger(n) || n > SEED_MAX) {
    return { ok: false, error: `种子不能超过 ${SEED_MAX}` }
  }
  return { ok: true, value: n }
}

export function seedText(seed: number | undefined): string {
  return seed === undefined ? '' : String(seed)
}

// ── 状态 CRUD（同一组合下的一体化状态） ──

export function addState(combo: Combo, name?: string): {
  combo: Combo
  state: CharacterState
} {
  const state = emptyState(name ?? `状态 ${(combo.states ?? []).length + 1}`)
  return {
    combo: { ...combo, states: [...(combo.states ?? []), state] },
    state,
  }
}

export function duplicateStateIn(
  combo: Combo,
  stateId: string,
): { combo: Combo; state: CharacterState } | null {
  const states = combo.states ?? []
  const idx = states.findIndex((s) => s.id === stateId)
  if (idx < 0) return null
  const state = duplicateState(states[idx])
  const next = [...states.slice(0, idx + 1), state, ...states.slice(idx + 1)]
  return { combo: { ...combo, states: next }, state }
}

export function removeStateFrom(combo: Combo, stateId: string): Combo {
  return {
    ...combo,
    states: (combo.states ?? []).filter((s) => s.id !== stateId),
  }
}

export function updateStateIn(
  combo: Combo,
  stateId: string,
  fn: (s: CharacterState) => CharacterState,
): Combo {
  return {
    ...combo,
    states: (combo.states ?? []).map((s) => (s.id === stateId ? fn(s) : s)),
  }
}

// 状态种子：undefined 表示沿用人物种子（删除字段，不写 undefined 键）
export function withStateSeed(
  state: CharacterState,
  seed: number | undefined,
): CharacterState {
  const { seed: _drop, ...rest } = state
  return seed === undefined ? rest : { ...rest, seed }
}

// ── 造型调整（外观与服饰） ──

export type OverrideChoice = 'inherit' | StateOverrideMode

export function overrideChoice(
  state: CharacterState,
  target: StateOverrideTarget,
): OverrideChoice {
  return state.overrides?.[target]?.mode ?? 'inherit'
}

// 父级（被覆盖前）的分类：Base 头发已包含组合发型覆盖
export function parentSegmentFor(
  base: Base,
  combo: Combo,
  target: StateOverrideTarget,
): Segment {
  if (target === 'base.hair') {
    return combo.hairOverride.enabled
      ? combo.hairOverride.segment
      : base.segments.hair
  }
  if (target.startsWith('base.')) {
    return base.segments[target.slice(5) as keyof Base['segments']]
  }
  return combo.segments[
    target.slice(8) as keyof Combo['segments']
  ]
}

// 切换模式：inherit 删除条目；append / replace 之间保留已编辑的内容
export function setOverrideChoice(
  state: CharacterState,
  target: StateOverrideTarget,
  choice: OverrideChoice,
): CharacterState {
  const overrides = { ...state.overrides }
  if (choice === 'inherit') {
    delete overrides[target]
  } else {
    overrides[target] = {
      mode: choice,
      content: overrides[target]?.content ?? emptySegment(),
    }
  }
  return { ...state, overrides }
}

export function updateOverrideContent(
  state: CharacterState,
  target: StateOverrideTarget,
  fn: (seg: Segment) => Segment,
): CharacterState {
  const cur = state.overrides?.[target]
  if (!cur) return state
  return {
    ...state,
    overrides: {
      ...state.overrides,
      [target]: { ...cur, content: fn(cur.content) },
    },
  }
}

// 复制造型内容到这里：深拷贝父级（新 id），设为 replace
export function copyParentToOverride(
  state: CharacterState,
  target: StateOverrideTarget,
  parent: Segment,
): CharacterState {
  return {
    ...state,
    overrides: {
      ...state.overrides,
      [target]: { mode: 'replace', content: cloneSegment(parent) },
    },
  }
}

// 本状态不输出此分类：空内容的 replace
export function clearOverrideOutput(
  state: CharacterState,
  target: StateOverrideTarget,
): CharacterState {
  return {
    ...state,
    overrides: {
      ...state.overrides,
      [target]: { mode: 'replace', content: emptySegment() },
    },
  }
}

export const OVERRIDE_CHOICE_LABEL: Record<OverrideChoice, string> = {
  inherit: '沿用造型',
  append: '保留并补充',
  replace: '改用本状态内容',
}

// 标题行摘要：数量 + 各分类标签与模式；无调整 = 沿用造型
export function adjustmentsHeader(state: CharacterState): {
  count: number
  labels: string[]
  text: string
} {
  const entries = STATE_OVERRIDE_TARGETS.flatMap((t) => {
    const o: StateOverride | undefined = state.overrides?.[t]
    return o ? [[t, o] as const] : []
  })
  const labels = entries.map(([t, o]) =>
    `${overrideTargetLabel(t)}（${overrideModeLabel(t, o)}）`
  )
  const count = entries.length
  return {
    count,
    labels,
    text: count > 0 ? `${count} 项调整：${labels.join('、')}` : '沿用造型',
  }
}
