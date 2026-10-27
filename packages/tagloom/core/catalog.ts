// 词库（只读）：接口与业务规则。词库只辅助选词；不可用时返回 verified=false，调用方照常手动编辑，
// 不能把「未核查」显示成「无匹配」。
import {
  type CatalogCategoryPage,
  type CatalogHit,
  type CatalogLookup,
  type CatalogStatus,
  type CatalogTag,
  type CatalogTagDetail,
  fieldDef,
  type TextMatchResult,
  type TextMatchTier,
} from '../share/mod.ts'
import { TagloomError } from './characters.ts'

// 词库实现（infra 的 SQLite 版本）
export interface TagCatalog {
  status(): CatalogStatus
  version(): string
  // 全库检索自由文本（事实、人物概要片段），inPaths 内的结果标记 inField 并优先
  search(text: string, limit: number, inPaths: string[]): CatalogHit[]
  // 同 search，取 offset 起的一页并给出总数
  searchPage(
    text: string,
    inPaths: string[],
    offset: number,
    limit: number,
  ): { items: CatalogHit[]; total: number }
  lookup(name: string): CatalogLookup
  // 列出分类（含后代）内的标签；q 非空时在这些分类内按名称 / 别名过滤
  listInCategories(paths: string[], q: string, limit: number): CatalogTag[]
  // 自然语言粗筛：宁多勿漏，每个候选都带原文依据；limit 只截断返回的候选
  matchText(
    text: string,
    limit: number,
    options?: { offset?: number; tiers?: TextMatchTier[] },
  ): TextMatchResult
  // 浏览分类：path 为空 = 根分类列表；分类不存在时返回 null
  category(
    path: string,
    q: string,
    limit: number,
    offset: number,
  ): CatalogCategoryPage | null
  // 单个标签的完整信息；不存在（或是未开放的受限标签）时返回 null
  tagDetail(canonical: string): CatalogTagDetail | null
}

export type CatalogResult<T> =
  | { verified: true; catalogVersion: string; items: T[] }
  | { verified: false; catalogVersion: null; reason: string; items: [] }

// 分类输入框的下拉建议：items 是本分类（paths 及其后代）内按名称 / 别名匹配的标签；
// others 是全库检索里不在本分类的结果，供参考（也可以加到本分类）
export type SegmentSearchResult =
  | (CatalogResult<CatalogTag> & { verified: true; others: CatalogHit[] })
  | (CatalogResult<CatalogTag> & { verified: false; others: [] })

const OTHERS_SCAN = 80

export function createCatalogService(
  catalog: TagCatalog | null,
  unavailableReason: string,
) {
  const unavailable = (): CatalogResult<never> => ({
    verified: false,
    catalogVersion: null,
    reason: unavailableReason,
    items: [],
  })
  const pathsOf = (field: string | undefined) =>
    (field ? fieldDef(field)?.categoryPaths : undefined) ?? []

  return {
    status(): CatalogStatus {
      return catalog?.status() ??
        { available: false, reason: unavailableReason }
    },

    search(
      text: string,
      field: string | undefined,
      limit: number,
    ): CatalogResult<CatalogHit> {
      if (!catalog) return unavailable()
      const q = text.trim()
      return {
        verified: true,
        catalogVersion: catalog.version(),
        items: q ? catalog.search(q, limit, pathsOf(field)) : [],
      }
    },

    segmentSearch(
      text: string,
      paths: string[],
      limit: number,
      othersLimit: number,
    ): SegmentSearchResult {
      if (!catalog) return { ...unavailable(), others: [] }
      const q = text.trim()
      if (!q) {
        return {
          verified: true,
          catalogVersion: catalog.version(),
          items: [],
          others: [],
        }
      }
      const items = paths.length
        ? catalog.listInCategories(paths, q, limit)
        : []
      const inSection = new Set(items.map((t) => t.canonical))
      // search 把本分类的结果排在前面：多取一些，过滤掉本分类后才剩得下其他分类的结果
      const others = catalog.search(q, OTHERS_SCAN, paths)
        .filter((h) => !h.inField && !inSection.has(h.canonical))
        .slice(0, othersLimit)
      return {
        verified: true,
        catalogVersion: catalog.version(),
        items,
        others,
      }
    },

    matchText(
      text: string,
      limit: number,
    ):
      | ({ verified: true; catalogVersion: string } & TextMatchResult)
      | { verified: false; catalogVersion: null; reason: string } {
      if (!catalog) {
        return {
          verified: false,
          catalogVersion: null,
          reason: unavailableReason,
        }
      }
      const q = text.trim()
      return {
        verified: true,
        catalogVersion: catalog.version(),
        ...(q
          ? catalog.matchText(q, limit)
          : { candidates: [], total: 0, categoryHints: [], unmatched: [] }),
      }
    },

    category(
      path: string,
      q: string,
      limit: number,
      offset: number,
    ):
      | ({ verified: true; catalogVersion: string } & CatalogCategoryPage)
      | { verified: false; catalogVersion: null; reason: string } {
      if (!catalog) {
        return {
          verified: false,
          catalogVersion: null,
          reason: unavailableReason,
        }
      }
      const page = catalog.category(path.trim(), q.trim(), limit, offset)
      if (!page) {
        throw new TagloomError('not_found', `词库里没有分类 ${path}`, { path })
      }
      return { verified: true, catalogVersion: catalog.version(), ...page }
    },

    tagDetail(
      canonical: string,
    ):
      | { verified: true; catalogVersion: string; tag: CatalogTagDetail }
      | { verified: false; catalogVersion: null; reason: string } {
      if (!catalog) {
        return {
          verified: false,
          catalogVersion: null,
          reason: unavailableReason,
        }
      }
      const tag = catalog.tagDetail(canonical)
      if (!tag) {
        throw new TagloomError('not_found', `词库里没有标签 ${canonical}`, {
          canonical,
        })
      }
      return { verified: true, catalogVersion: catalog.version(), tag }
    },

    // 字段选词列表：只在字段对应的词库分类里取；没有分类（文本优先 / 仅资料）时为空
    fieldTags(
      field: string,
      q: string,
      limit: number,
    ): CatalogResult<CatalogTag> {
      if (!catalog) return unavailable()
      const paths = pathsOf(field)
      return {
        verified: true,
        catalogVersion: catalog.version(),
        items: paths.length
          ? catalog.listInCategories(paths, q.trim(), limit)
          : [],
      }
    },
  }
}

export type CatalogService = ReturnType<typeof createCatalogService>
