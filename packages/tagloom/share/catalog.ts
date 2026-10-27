// 词库检索结果的类型（服务端返回、前端展示共用）。词库只辅助选词，不存用户资料。
import type { MatchKind, TagRef } from './model.ts'

// 词库统一的规范化规则：生成词库（catalog-import）和检索（infra/sqlite-catalog）都用它
export function normalizeTerm(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/_/g, ' ').replace(
    /\s+/g,
    ' ',
  ).trim()
}

export interface CatalogTag {
  canonical: string
  labelZh: string
  labelEn: string
  labelJa: string
  // 别名记录：本词库的 alias 里混有其他中文译名，不一定是官方英文别名
  aliases: string[]
  // 来源图库频次，不是成图效果或质量
  postCount: number
  // 说明（CSV notes），没有时为空
  notes: string
  categoryPath: string
  categoryLabelZh: string
  sources: string[]
}

export interface CatalogHit extends CatalogTag {
  match: Exclude<MatchKind, 'manual'>
  evidence: string
  // 是否在当前字段对应的词库分类内
  inField: boolean
  // 只靠说明命中（evidence 是说明里找到的检索词）
  byNote?: true
}

// 核对一个名字：exact = 与 canonical 一致；label = 三语名称；alias = 别名；
// ambiguous = 对应多个标签（tags 按频次）；none = 没找到（suggestions 是检索结果，仅供参考）
export interface CatalogLookup {
  status: 'exact' | 'label' | 'alias' | 'ambiguous' | 'none'
  tags: CatalogTag[]
  suggestions: CatalogHit[]
}

// 单个标签的完整信息（详情栏、agent 查询用）
export interface CatalogTagDetail extends CatalogTag {
  // 从根到标签所在分类，每层的三语名称
  categoryTrail: {
    path: string
    labelZh: string
    labelEn: string
    labelJa: string
  }[]
  // 所在分类自己（不含子分类）的标签数
  categoryOwnCount: number
  // 提到过这个标签的导入（按导入顺序）和其中的原始写法
  sourceRecords: { source: string; key: string }[]
}

// 词库分类（按 path 区分；tagCount 含所有后代分类里的标签）
export interface CatalogCategory {
  path: string
  labelZh: string
  labelEn: string
  labelJa: string
  tagCount: number
}

// 浏览一个分类：path 为空时 category 为 null，children 是各根分类
export interface CatalogCategoryPage {
  category: CatalogCategory | null
  // 从根到父分类
  ancestors: { path: string; labelZh: string }[]
  // 有标签的子分类，标签多的在前
  children: CatalogCategory[]
  // 本分类及所有后代里的标签（q 非空时按名称 / 别名过滤），按频次排序
  tags: CatalogTag[]
  // 符合条件的标签总数（tags 是其中 offset 起的一页）
  total: number
  offset: number
}

// 自然语言粗筛（宁多勿漏）：exact 原样出现 > loose 字可不挨着 / 词序不限 > related 名字包含命中词 > single 单字
export type TextMatchTier = 'exact' | 'loose' | 'related' | 'single'

export interface TextMatchHit {
  rule: 'exact' | 'gap' | 'words' | 'contains' | 'single'
  // 词库里的词
  term: string
  // 对应原文（规范化后）的片段
  text: string
}

export interface TextMatchTag extends CatalogTag {
  tier: TextMatchTier
  hits: TextMatchHit[]
}

export interface TextMatchResult {
  candidates: TextMatchTag[]
  // 候选总数（candidates 可能被截断）
  total: number
  // 原文提到的词库分类名：只提示，不展开成标签
  categoryHints: { path: string; labelZh: string; text: string }[]
  // 没有命中任何标签的片段
  unmatched: string[]
}

export const TEXT_MATCH_TIER_LABEL: Record<TextMatchTier, string> = {
  exact: '原样出现',
  loose: '宽松匹配',
  related: '相关（名字包含命中词）',
  single: '单字',
}

export type CatalogStatus =
  | {
    available: true
    version: string
    tagCount: number
    sources: { name: string; revision: string; license: string }[]
  }
  | { available: false; reason: string }

export function tagRefOf(
  tag: CatalogTag,
  catalogVersion: string | null,
): TagRef {
  return {
    canonical: tag.canonical,
    labelZh: tag.labelZh,
    categoryPath: tag.categoryPath,
    catalogVersion,
  }
}

export const MATCH_LABEL: Record<MatchKind, string> = {
  canonical: 'canonical 精确',
  alias: '别名／替代译名',
  label: '中文／英文名称',
  partial: '部分匹配',
  none: '无匹配',
  manual: '手选',
}
