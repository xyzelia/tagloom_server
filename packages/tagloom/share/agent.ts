// AI agent 写入：分类地址、「AI 变更」记录及其合并规则。前后端共用（服务端保存时合并，编辑页拉取时合并），保证结果一致。
// AI 只做追加：在角色标签库新增标签，或把标签作为勾选的条目加进某个分类；不修改、不删除已有内容。
import {
  ACTION_SEGMENT,
  BASE_SEGMENT_KEYS,
  BASE_SEGMENTS,
  type BaseSegmentKey,
  COMBO_SEGMENT_KEYS,
  COMBO_SEGMENTS,
  type ComboSegmentKey,
  EXPRESSION_SEGMENT,
  HAIR_OVERRIDE_SEGMENT,
  overrideSegmentDef,
  overrideTargetLabel,
  type SegmentDef,
  STATE_OVERRIDE_TARGETS,
  type StateOverrideTarget,
} from './fields.ts'
import type {
  CharacterContent,
  CustomTag,
  PromptItem,
  Segment,
} from './model.ts'

// 分类地址：base.<分类>、combo.<组合id>.<分类>、combo.<组合id>.hair_override、
// combo.<组合id>.state.<状态id>.expression|action、
// combo.<组合id>.state.<状态id>.override.<base.xxx|costume.xxx>
export type SegmentAddress = string

export interface SegmentRef {
  address: SegmentAddress
  label: string
  def: SegmentDef
  segment: Segment
}

// 列出人物的所有分类（Base、各组合、各组合的发型覆盖）
export function listSegments(c: CharacterContent): SegmentRef[] {
  const out: SegmentRef[] = BASE_SEGMENTS.map((def) => ({
    address: `base.${def.key}`,
    label: `Base · ${def.label}`,
    def,
    segment: c.base.segments[def.key],
  }))
  for (const combo of c.combos) {
    const name = combo.name || '未命名组合'
    for (const def of COMBO_SEGMENTS) {
      out.push({
        address: `combo.${combo.id}.${def.key}`,
        label: `${name} · ${def.label}`,
        def,
        segment: combo.segments[def.key],
      })
    }
    out.push({
      address: `combo.${combo.id}.hair_override`,
      label: `${name} · 发型覆盖${
        combo.hairOverride.enabled ? '' : '（未启用）'
      }`,
      def: HAIR_OVERRIDE_SEGMENT,
      segment: combo.hairOverride.segment,
    })
    for (const state of combo.states ?? []) {
      const prefix = `combo.${combo.id}.state.${state.id}`
      const stateName = `${name} · 状态 ${state.name || '未命名状态'}`
      out.push(
        {
          address: `${prefix}.expression`,
          label: `${stateName} · ${EXPRESSION_SEGMENT.label}`,
          def: EXPRESSION_SEGMENT,
          segment: state.expression,
        },
        {
          address: `${prefix}.action`,
          label: `${stateName} · ${ACTION_SEGMENT.label}`,
          def: ACTION_SEGMENT,
          segment: state.action,
        },
      )
      for (const target of STATE_OVERRIDE_TARGETS) {
        const o = state.overrides[target]
        if (!o) continue
        out.push({
          address: `${prefix}.override.${target}`,
          label: `${stateName} · 覆盖 ${overrideTargetLabel(target)}`,
          def: overrideSegmentDef(target),
          segment: o.content,
        })
      }
    }
  }
  return out
}

export function findSegment(
  c: CharacterContent,
  address: SegmentAddress,
): SegmentRef | undefined {
  return listSegments(c).find((s) => s.address === address)
}

// 修改指定地址的分类；地址不存在时原样返回
export function updateSegmentAt(
  c: CharacterContent,
  address: SegmentAddress,
  fn: (seg: Segment) => Segment,
): CharacterContent {
  const parts = address.split('.')
  if (parts[0] === 'base' && parts.length === 2) {
    const key = parts[1] as BaseSegmentKey
    if (!(BASE_SEGMENT_KEYS as readonly string[]).includes(key)) return c
    return {
      ...c,
      base: {
        ...c.base,
        segments: { ...c.base.segments, [key]: fn(c.base.segments[key]) },
      },
    }
  }
  if (parts[0] === 'combo' && parts[2] === 'state' && parts.length >= 5) {
    const [, comboId, , stateId, kind, ...rest] = parts
    const target = rest.join('.')
    const combo = c.combos.find((x) => x.id === comboId)
    const state = combo?.states?.find((x) => x.id === stateId)
    if (!combo || !state) return c
    let next: typeof state
    if (kind === 'expression' && rest.length === 0) {
      next = { ...state, expression: fn(state.expression) }
    } else if (kind === 'action' && rest.length === 0) {
      next = { ...state, action: fn(state.action) }
    } else if (
      kind === 'override' &&
      (STATE_OVERRIDE_TARGETS as readonly string[]).includes(target)
    ) {
      // 只改已存在的覆盖，保留其 mode；不创建新覆盖
      const t = target as StateOverrideTarget
      const o = state.overrides[t]
      if (!o) return c
      next = {
        ...state,
        overrides: {
          ...state.overrides,
          [t]: { ...o, content: fn(o.content) },
        },
      }
    } else return c
    return {
      ...c,
      combos: c.combos.map((x) =>
        x.id === comboId
          ? { ...x, states: x.states.map((y) => (y.id === stateId ? next : y)) }
          : x
      ),
    }
  }
  if (parts[0] === 'combo' && parts.length === 3) {
    const [, comboId, key] = parts
    if (!c.combos.some((x) => x.id === comboId)) return c
    if (key === 'hair_override') {
      return {
        ...c,
        combos: c.combos.map((x) =>
          x.id === comboId
            ? {
              ...x,
              hairOverride: {
                ...x.hairOverride,
                segment: fn(x.hairOverride.segment),
              },
            }
            : x
        ),
      }
    }
    if (!(COMBO_SEGMENT_KEYS as readonly string[]).includes(key)) return c
    const k = key as ComboSegmentKey
    return {
      ...c,
      combos: c.combos.map((x) =>
        x.id === comboId
          ? { ...x, segments: { ...x.segments, [k]: fn(x.segments[k]) } }
          : x
      ),
    }
  }
  return c
}

// 一次 AI 写入
export interface AgentChange {
  // 写入后的人物版本号
  version: number
  agentName: string
  // epoch 毫秒
  at: number
  tags: CustomTag[]
  items: { segment: SegmentAddress; item: PromptItem }[]
}

export interface MergeResult {
  content: CharacterContent
  tagsAdded: number
  itemsAdded: number
  // 合并时找不到的分类（如组合在本地已被删除）
  skipped: string[]
}

// 把 AI 变更合并进一份人物内容：标签按 id 追加（已有则跳过）；条目追加到对应分类，
// 同一分类已有同一自创标签的条目时只把它重新勾选，不重复添加。
export function applyAgentChanges(
  content: CharacterContent,
  changes: AgentChange[],
): MergeResult {
  let c = content
  let tagsAdded = 0
  let itemsAdded = 0
  const skipped: string[] = []
  for (const change of changes) {
    for (const tag of change.tags) {
      if (c.customTags.some((t) => t.id === tag.id)) continue
      c = { ...c, customTags: [...c.customTags, tag] }
      tagsAdded++
    }
    for (const { segment, item } of change.items) {
      const ref = findSegment(c, segment)
      if (!ref) {
        skipped.push(`分类 ${segment} 不存在，条目「${item.text}」未加入`)
        continue
      }
      if (ref.segment.items.some((i) => i.id === item.id)) continue
      const same = item.source.kind === 'custom'
        ? ref.segment.items.find((i) =>
          i.source.kind === 'custom' && item.source.kind === 'custom' &&
          i.source.customId === item.source.customId
        )
        : undefined
      c = updateSegmentAt(c, segment, (s) =>
        same
          ? {
            ...s,
            items: s.items.map((
              i,
            ) => (i.id === same.id ? { ...i, included: true } : i)),
          }
          : { ...s, items: [...s.items, item] })
      itemsAdded++
    }
  }
  return { content: c, tagsAdded, itemsAdded, skipped }
}
