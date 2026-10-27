// agent 词库批量接口（/agent/catalog/*）：输入校验、逐条查询、分页结构。设计与前提见 doc/AGENT_CATALOG_API.md。
// 每条查询各自分页：没超过 limit 只返回 items；分了页的每一页都带 total，还有下一页时带 nextOffset。
// 单条出错只写在那一条的 error 里；词库不可用时整个响应 verified=false。
import { z } from 'zod'
import { type CatalogTag, fieldDef } from '../share/mod.ts'
import type { TagCatalog } from './catalog.ts'

export const AGENT_PAGE_LIMIT = 100
export const MAX_AGENT_QUERIES = 20
export const MAX_AGENT_NAMES = 100

// 超过 100 按 100 处理
const limit = z.number().int().min(1).default(AGENT_PAGE_LIMIT)
  .transform((n) => Math.min(n, AGENT_PAGE_LIMIT))
const offset = z.number().int().min(0).max(100_000)
const pagedRequest = {
  limit,
  // 翻页时带回第一页的 catalogVersion；不一致时 offset > 0 的查询返回 catalog_changed
  catalogVersion: z.string().max(200).optional(),
}
const queries = <T extends z.ZodRawShape>(shape: T) =>
  z.array(z.object(shape)).min(1).max(MAX_AGENT_QUERIES)
const names = z.array(z.string().trim().min(1).max(500)).min(1).max(
  MAX_AGENT_NAMES,
)

// 每条查询的字段不设默认值：结果里的 input 原样回显请求里的这一条
export const agentLookupInput = z.object({ tags: names })
export const agentTagsInput = z.object({ canonicals: names })
export const agentMatchInput = z.object({
  ...pagedRequest,
  queries: queries({
    text: z.string().trim().min(1).max(8000),
    tiers: z.array(z.enum(['exact', 'loose', 'related', 'single'])).min(1)
      .max(4).optional(),
    offset: offset.optional(),
  }),
})
export const agentSearchInput = z.object({
  ...pagedRequest,
  queries: queries({
    q: z.string().trim().min(1).max(2000),
    field: z.string().max(100).optional(),
    offset: offset.optional(),
  }),
})
export const agentCategoriesInput = z.object({
  ...pagedRequest,
  queries: queries({
    // 不传或为空 = 列出根分类
    path: z.string().max(500).optional(),
    q: z.string().max(200).optional(),
    offset: offset.optional(),
  }),
})

// 给 agent 的精简标签；完整信息用 /agent/catalog/tags
export interface AgentTag {
  canonical: string
  labelZh: string
  categoryPath: string
  postCount: number
}

const brief = (t: CatalogTag): AgentTag => ({
  canonical: t.canonical,
  labelZh: t.labelZh,
  categoryPath: t.categoryPath,
  postCount: t.postCount,
})

export interface AgentItemError {
  code: 'not_found' | 'catalog_changed' | 'invalid_request'
  message: string
}

// 分页结构：没分页只有 items；分了页带 total，还有下一页再带 nextOffset
export function agentPage<T>(
  items: T[],
  total: number,
  offset: number,
  limit: number,
): { items: T[]; total?: number; nextOffset?: number } {
  if (offset === 0 && total <= limit) return { items }
  const next = offset + items.length
  return next < total ? { items, total, nextOffset: next } : { items, total }
}

export function createAgentCatalogService(
  catalog: TagCatalog | null,
  unavailableReason: string,
) {
  function respond<R>(fn: (catalog: TagCatalog, version: string) => R[]) {
    if (!catalog) {
      return {
        verified: false as const,
        catalogVersion: null,
        reason: unavailableReason,
      }
    }
    const version = catalog.version()
    return {
      verified: true as const,
      catalogVersion: version,
      results: fn(catalog, version),
    }
  }

  // 翻页时词库已换：这一条要从第一页重查
  const changed = (
    requested: string | undefined,
    version: string,
    at: number,
  ): AgentItemError | null =>
    requested !== undefined && requested !== version && at > 0
      ? {
        code: 'catalog_changed',
        message: `词库已更新（当前 ${version}），请从第一页重新查询`,
      }
      : null

  return {
    lookup(input: z.infer<typeof agentLookupInput>) {
      return respond((cat) =>
        input.tags.map((name) => {
          const r = cat.lookup(name)
          if (r.status === 'none') {
            return {
              input: name,
              status: r.status,
              suggestions: r.suggestions.map(brief),
            }
          }
          if (r.status === 'ambiguous') {
            return { input: name, status: r.status, tags: r.tags.map(brief) }
          }
          return { input: name, status: r.status, tag: brief(r.tags[0]) }
        })
      )
    },

    tags(input: z.infer<typeof agentTagsInput>) {
      return respond((cat) =>
        input.canonicals.map((name) => {
          const tag = cat.tagDetail(name)
          return tag ? { input: name, tag } : {
            input: name,
            error: {
              code: 'not_found',
              message: `词库里没有标签 ${name}`,
            } satisfies AgentItemError,
          }
        })
      )
    },

    match(input: z.infer<typeof agentMatchInput>) {
      return respond((cat, version) =>
        input.queries.map((q) => {
          const at = q.offset ?? 0
          const error = changed(input.catalogVersion, version, at)
          if (error) return { input: q, error }
          const r = cat.matchText(q.text, input.limit, {
            offset: at,
            tiers: q.tiers,
          })
          return {
            input: q,
            ...agentPage(
              r.candidates.map((c) => ({
                ...brief(c),
                tier: c.tier,
                hits: c.hits.map((h) => ({ text: h.text, term: h.term })),
              })),
              r.total,
              at,
              input.limit,
            ),
            // 附加信息只在第一页
            ...(at === 0
              ? { categoryHints: r.categoryHints, unmatched: r.unmatched }
              : {}),
          }
        })
      )
    },

    search(input: z.infer<typeof agentSearchInput>) {
      return respond((cat, version) =>
        input.queries.map((q) => {
          const at = q.offset ?? 0
          const error = changed(input.catalogVersion, version, at)
          if (error) return { input: q, error }
          const def = q.field ? fieldDef(q.field) : undefined
          if (q.field && !def) {
            return {
              input: q,
              error: {
                code: 'invalid_request',
                message: `未知字段 ${q.field}`,
              } satisfies AgentItemError,
            }
          }
          const r = cat.searchPage(
            q.q,
            def?.categoryPaths ?? [],
            at,
            input.limit,
          )
          return {
            input: q,
            ...agentPage(
              r.items.map((h) => ({
                ...brief(h),
                match: h.match,
                evidence: h.evidence,
                ...(q.field ? { inField: h.inField } : {}),
              })),
              r.total,
              at,
              input.limit,
            ),
          }
        })
      )
    },

    categories(input: z.infer<typeof agentCategoriesInput>) {
      return respond((cat, version) =>
        input.queries.map((q) => {
          const at = q.offset ?? 0
          const error = changed(input.catalogVersion, version, at)
          if (error) return { input: q, error }
          const path = q.path?.trim() ?? ''
          const page = cat.category(path, q.q?.trim() ?? '', input.limit, at)
          if (!page) {
            return {
              input: q,
              error: {
                code: 'not_found',
                message: `词库里没有分类 ${path}`,
              } satisfies AgentItemError,
            }
          }
          const label = (c: { labelZh: string; labelEn?: string }) =>
            c.labelZh || c.labelEn || ''
          return {
            input: q,
            // 分类信息、上级、子分类只在第一页
            ...(at === 0
              ? {
                category: page.category && {
                  path: page.category.path,
                  labelZh: label(page.category),
                  tagCount: page.category.tagCount,
                },
                ancestors: page.ancestors,
                children: page.children.map((c) => ({
                  path: c.path,
                  labelZh: label(c),
                  tagCount: c.tagCount,
                })),
              }
              : {}),
            ...agentPage(page.tags.map(brief), page.total, at, input.limit),
          }
        })
      )
    },
  }
}

export type AgentCatalogService = ReturnType<typeof createAgentCatalogService>
