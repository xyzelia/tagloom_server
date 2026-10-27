// 自创标签库：人物和场景各有一份。人工或 AI 都可以创建，记录创建来源。纯函数，作用于带 customTags 的整份内容。
// AI 创建的标签与人工创建的同样直接可用（用户在最终 Prompt 里决定是否勾选），来源始终可见。
import {
  type CharacterContent,
  type CustomTag,
  newId,
  nowMs,
  type Origin,
  type Segment,
} from './model.ts'
import { stateSegments } from './presence.ts'

export interface CustomTagInput {
  text: string
  label?: string
  fields?: string[]
  note?: string
}

export function createCustomTag(
  input: CustomTagInput,
  by: { origin: Origin; agentName?: string },
  now = nowMs(),
): CustomTag {
  return {
    id: newId(),
    text: input.text.trim(),
    label: (input.label ?? '').trim(),
    fields: input.fields ?? [],
    note: (input.note ?? '').trim(),
    origin: by.origin,
    agentName: by.origin === 'agent' ? (by.agentName ?? '').trim() : '',
    createdAt: now,
  }
}

// 带标签库的内容：人物内容或场景内容
type WithTags = { customTags: CustomTag[] }

export function addCustomTag<T extends WithTags>(c: T, tag: CustomTag): T {
  if (!tag.text) return c
  return { ...c, customTags: [...c.customTags, tag] }
}

// 修改标签库条目；来源（origin / agentName / createdAt）不随修改变化
export function updateCustomTag<T extends WithTags>(
  c: T,
  id: string,
  patch: Partial<Pick<CustomTag, 'text' | 'label' | 'fields' | 'note'>>,
): T {
  return {
    ...c,
    customTags: c.customTags.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }
}

// 删除标签库条目：已在用的条目保留（文本和来源不变），只是界面上显示「标签已从标签库删除」
export function removeCustomTag<T extends WithTags>(c: T, id: string): T {
  return { ...c, customTags: c.customTags.filter((t) => t.id !== id) }
}

// 某字段可选用的自创标签：fields 为空表示所有字段都显示
export function customTagsForField(
  tags: CustomTag[],
  field: string,
): CustomTag[] {
  return tags.filter((t) => t.fields.length === 0 || t.fields.includes(field))
}

// 遍历所有分类（Base、各组合、发型覆盖），用于统计用量
export function allSegments(c: CharacterContent): Segment[] {
  return [
    ...Object.values(c.base.segments),
    ...c.combos.flatMap((combo) => [
      ...Object.values(combo.segments),
      combo.hairOverride.segment,
      ...(combo.states ?? []).flatMap(stateSegments),
    ]),
  ]
}

// 自创标签被多少个条目使用（含未勾选）
export function customTagUsage(c: CharacterContent): Map<string, number> {
  return customTagUsageIn(allSegments(c))
}

export function customTagUsageIn(segments: Segment[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const seg of segments) {
    for (const i of seg.items) {
      if (i.source.kind === 'custom') {
        out.set(i.source.customId, (out.get(i.source.customId) ?? 0) + 1)
      }
    }
  }
  return out
}
