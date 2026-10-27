// 栏目是否已有记录，不等同于是否有最终输出：未勾选条目、事实、OPEN/N/A 也算内容。
import type { CharacterState, Combo, Segment } from './model.ts'

export function hasSegmentContent(segment: Segment): boolean {
  return segment.items.some((item) => item.text.trim().length > 0) ||
    segment.facts.some((fact) =>
      fact.text.trim().length > 0 || fact.sourceQuote.trim().length > 0 ||
      fact.candidates.length > 0
    ) || Object.keys(segment.fieldStates).length > 0
}

export function stateSegments(state: CharacterState): Segment[] {
  return [
    state.expression,
    state.action,
    ...Object.values(state.overrides).map((o) => o!.content),
  ]
}

export function hasStateContent(state: CharacterState): boolean {
  return stateSegments(state).some(hasSegmentContent) ||
    Object.keys(state.overrides).length > 0 || state.seed !== undefined ||
    state.note.trim().length > 0
}

export function hasComboContent(combo: Combo): boolean {
  return Object.values(combo.segments).some(hasSegmentContent) ||
    hasSegmentContent(combo.hairOverride.segment) ||
    (combo.states ?? []).some(hasStateContent)
}
