// AI agent 接口的输入校验与给 agent 看的精简人物信息。写入逻辑在 characters.ts 的 service 里（走同一个写入队列）。
import { z } from 'zod'
import {
  type Character,
  displayTitle,
  listSegments,
  segmentText,
} from '../share/mod.ts'

export const MAX_AGENT_TAGS_PER_REQUEST = 50
// 用户一直不保存时，AI 变更记录的上限（防止文件无限增长）
export const MAX_PENDING_AGENT_CHANGES = 200

export const agentAddTagsInput = z.object({
  // 哪个 agent / 模型；记录在标签和条目的来源上
  agentName: z.string().trim().min(1).max(100),
  tags: z.array(z.object({
    text: z.string().trim().min(1).max(2000),
    label: z.string().trim().max(500).optional(),
    // 建议归属的选词字段 key；不传或空数组 = 所有字段都显示
    fields: z.array(z.string().max(100)).max(100).optional(),
    note: z.string().trim().max(2000).optional(),
    // 同时作为勾选的条目加进这些分类（会改变输出）
    addTo: z.array(z.object({
      segment: z.string().max(200),
      // 条目所属字段；不传时取标签 fields 中属于该分类的第一个
      field: z.string().max(100).optional(),
    })).max(20).optional(),
  })).min(1).max(MAX_AGENT_TAGS_PER_REQUEST),
})
export type AgentAddTagsInput = z.infer<typeof agentAddTagsInput>

export interface AgentAddTagsResult {
  version: number
  created: { id: string; text: string; label: string }[]
  // 标签库里已有相同文本（不分大小写）的标签：不重复创建，addTo 使用已有标签
  reused: { id: string; text: string }[]
  items: { segment: string; text: string }[]
  skipped: string[]
}

// 给 agent 的精简人物信息：档案、标签库、每个分类的地址 / 可用字段 / 当前输出与条目
export function agentContext(c: Character) {
  return {
    path: c.path,
    version: c.version,
    title: displayTitle(c),
    profile: c.profile,
    subject: c.base.subject,
    customTags: c.customTags.map((t) => ({
      id: t.id,
      text: t.text,
      label: t.label,
      fields: t.fields,
      origin: t.origin,
      agentName: t.agentName,
    })),
    combos: c.combos.map((x) => ({
      id: x.id,
      name: x.name,
      hairOverrideEnabled: x.hairOverride.enabled,
    })),
    segments: listSegments(c).map((s) => ({
      address: s.address,
      label: s.label,
      fields: s.def.fields.map((f) => ({
        key: f.key,
        label: f.label,
        optional: f.optional,
      })),
      output: segmentText(s.segment),
      items: s.segment.items.map((i) => ({
        text: i.text,
        included: i.included,
        kind: i.source.kind,
        origin: i.origin,
      })),
    })),
  }
}
export type AgentContext = ReturnType<typeof agentContext>
