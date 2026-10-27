// 冲突与提示：只提示，不阻止保存、复制、导入或导出，也不自动修复。
import { assembleCombo, promptItems, segmentText } from './assemble.ts'
import {
  ACTION_SEGMENT,
  BASE_SEGMENTS,
  COMBO_SEGMENTS,
  EXPRESSION_SEGMENT,
  fieldDef,
  HAIR_OVERRIDE_SEGMENT,
  overrideTargetLabel,
  STATE_OVERRIDE_TARGETS,
} from './fields.ts'
import { isSourceStale } from './facts.ts'
import type { CharacterContent, Segment } from './model.ts'

export interface Notice {
  // 'base' 或组合 id
  scope: string
  segment: string
  message: string
}

function segmentNotices(
  scope: string,
  segKey: string,
  segLabel: string,
  seg: Segment,
  c: CharacterContent,
  customIds: Set<string>,
): Notice[] {
  const out: Notice[] = []
  const push = (message: string) =>
    out.push({ scope, segment: segKey, message: `${segLabel}：${message}` })
  const fieldLabel = (k: string) => fieldDef(k)?.label ?? k

  for (const [field, state] of Object.entries(seg.fieldStates)) {
    const used = seg.items.some((i) => i.field === field && i.included) ||
      seg.facts.some((f) => f.field === field && f.status === 'confirmed')
    if (used) {
      push(
        `「${fieldLabel(field)}」标为${
          state === 'open' ? '不固定（OPEN）' : '不适用（N/A）'
        }，但仍有输出的条目或已确认事实`,
      )
    }
  }
  for (const item of seg.items) {
    if (item.source.kind === 'custom' && !customIds.has(item.source.customId)) {
      push(`条目「${item.text}」引用的自创标签已从标签库删除（条目本身保留）`)
    }
  }
  for (const fact of seg.facts) {
    if (isSourceStale(fact, c.profile)) {
      push(`事实「${fact.text}」的档案摘录已不在档案中，提取依据已变化`)
    }
  }
  return out
}

function dupItems(full: string): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const item of promptItems(full)) {
    const k = item.toLowerCase()
    if (seen.has(k)) dup.add(item)
    seen.add(k)
  }
  return [...dup]
}

export function collectNotices(c: CharacterContent): Notice[] {
  const out: Notice[] = []
  const customIds = new Set(c.customTags.map((t) => t.id))
  for (const def of BASE_SEGMENTS) {
    out.push(
      ...segmentNotices(
        'base',
        def.key,
        def.label,
        c.base.segments[def.key],
        c,
        customIds,
      ),
    )
  }
  for (const combo of c.combos) {
    const name = combo.name || '未命名组合'
    for (const def of COMBO_SEGMENTS) {
      out.push(
        ...segmentNotices(
          combo.id,
          def.key,
          `${name} · ${def.label}`,
          combo.segments[def.key],
          c,
          customIds,
        ),
      )
    }
    if (combo.hairOverride.enabled) {
      out.push(
        ...segmentNotices(
          combo.id,
          HAIR_OVERRIDE_SEGMENT.key,
          `${name} · 发型覆盖`,
          combo.hairOverride.segment,
          c,
          customIds,
        ),
      )
      if (!segmentText(combo.hairOverride.segment)) {
        out.push({
          scope: combo.id,
          segment: 'hair_override',
          message:
            `${name} · 发型覆盖：已启用但没有勾选的条目，该组合的头发段将为空（不会回退到 Base）`,
        })
      }
    }
    for (const state of combo.states ?? []) {
      const stateLabel = `${name} · 状态 ${state.name || '未命名状态'}`
      const segs: [string, string, Segment][] = [
        ['expression', EXPRESSION_SEGMENT.label, state.expression],
        ['action', ACTION_SEGMENT.label, state.action],
        ...STATE_OVERRIDE_TARGETS.flatMap((t): [string, string, Segment][] => {
          const o = state.overrides[t]
          return o
            ? [[`override.${t}`, `覆盖 ${overrideTargetLabel(t)}`, o.content]]
            : []
        }),
      ]
      for (const [key, label, seg] of segs) {
        out.push(
          ...segmentNotices(
            combo.id,
            `state.${state.id}.${key}`,
            `${stateLabel} · ${label}`,
            seg,
            c,
            customIds,
          ),
        )
      }
      const sdup = dupItems(assembleCombo(c, combo, state).full)
      if (sdup.length > 0) {
        out.push({
          scope: combo.id,
          segment: `state.${state.id}.full`,
          message: `${stateLabel}：完整 Prompt 中有重复条目：${
            sdup.join('、')
          }`,
        })
      }
    }
    // 完整 Prompt 里的重复条目（只提示，不去重）
    const items = promptItems(assembleCombo(c, combo).full)
    const seen = new Set<string>()
    const dup = new Set<string>()
    for (const item of items) {
      const k = item.toLowerCase()
      if (seen.has(k)) dup.add(item)
      seen.add(k)
    }
    if (dup.size > 0) {
      out.push({
        scope: combo.id,
        segment: 'full',
        message: `${name}：完整 Prompt 中有重复条目：${[...dup].join('、')}`,
      })
    }
  }
  return out
}
