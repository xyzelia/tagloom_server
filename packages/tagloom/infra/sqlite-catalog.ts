// TagCatalog 的 SQLite 实现：读取 v4 词库（doc/CATALOG_DB.md），打开时把全部数据读进内存、
// 建好检索索引后就关闭文件，之后的查询都在内存里完成。词库由 catalog-import 生成，这里从不写入。
// 检索策略：
//   1. 词项前缀：canonical / 三语名称 / 别名，命中词必须完整出现在输入里；
//   2. 词前缀：输入的每个词按前缀匹配各字段的词，按字段加权（代替原来的 FTS5 bm25）；
//   3. 中日文包含：名称、别名、分类名等中日文词被输入完整包含（二元组索引找候选）；
//   4. 说明（CSV notes）：说明里包含输入的每个词，逐条扫描，排在最后。
// 每个结果带命中依据（canonical / 别名 / 名称 / 部分匹配）与命中词，字段对应的分类优先（inField）。
// 库里不存规范化后的写法：所有索引在加载时用 normalizeTerm 生成，输入也先规范化再匹配。
// 词库版本 = schema_version + generated_at；用户资料里只保存 canonical 快照和这个版本。
import { DatabaseSync } from 'node:sqlite'
import type {
  CatalogCategory,
  CatalogCategoryPage,
  CatalogHit,
  CatalogLookup,
  CatalogStatus,
  CatalogTag,
  CatalogTagDetail,
  TextMatchResult,
  TextMatchTier,
} from '../share/mod.ts'
import { normalizeTerm } from '../share/mod.ts'
import type { TagCatalog } from '../core/mod.ts'
import {
  buildTextMatchIndex,
  matchText as runTextMatch,
  type TextMatchIndex,
} from './text-match.ts'

const SCHEMA_VERSION = 4
const FTS_BATCH_SIZE = 8
// lookup 找不到时给几个检索结果作参考
const LOOKUP_SUGGESTIONS = 5
const FTS_BATCH_LIMIT = 200
const CJK_GRAM_CANDIDATE_LIMIT = 512
const CJK_GRAM_LIMIT = 100
// 只靠说明命中的结果最多取几个（按频次）
const NOTE_LIMIT = 200
// 标签详情里最多列出的别名数
const ALIAS_DISPLAY_LIMIT = 8

// 词前缀检索的字段权重（与 v3 词库 bm25 的列权重一致）
const WEIGHT = { name: 12, alias: 6, label: 4, category: 1 }

interface Category {
  path: string
  parent: string | null
  labelZh: string
  labelEn: string
  labelJa: string
}

interface Tag {
  id: number
  name: string
  categoryPath: string
  labelEn: string
  labelJa: string
  // 显示用：优先 tags-tree 的中文名，没有时用 CSV 的
  labelZh: string
  postCount: number
  aliases: string[]
  // CSV 的说明（原文）
  notes: string
  sources: string[]
  sourceRecords: { source: string; key: string }[]
  // 分类内按名称过滤时比较的词（都已规范化）
  haystack: string[]
}

type TermKind = 'canonical' | 'label' | 'alias'
type Kind = TermKind | 'fuzzy' | 'note'

interface Term {
  norm: string
  tagId: number
  kind: TermKind
}

interface Cand {
  id: number
  kind: Kind
  evidence: string
  matchClass: number
  relevance: number
}

export interface SqliteCatalogOptions {
  path: string
  // 受限标签（restricted=1）默认不显示
  allowRestricted?: boolean
}

function tokenize(value: string): string[] {
  return normalizeTerm(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(
    0,
    32,
  )
}

const words = (value: string) =>
  normalizeTerm(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

// 排好序的数组里第一个 >= key 的位置
function lowerBound<T>(list: T[], key: string, of: (x: T) => string): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (of(list[mid]) < key) lo = mid + 1
    else hi = mid
  }
  return lo
}

// 前缀为 prefix 的所有元素
function* withPrefix<T>(list: T[], prefix: string, of: (x: T) => string) {
  for (let i = lowerBound(list, prefix, of); i < list.length; i++) {
    if (!of(list[i]).startsWith(prefix)) return
    yield list[i]
  }
}

export function openSqliteCatalog(options: SqliteCatalogOptions): TagCatalog & {
  close(): void
} {
  const db = new DatabaseSync(options.path, { readOnly: true })
  try {
    return createCatalog(db, options.allowRestricted ?? false)
  } finally {
    // 数据都已读进内存，不再占用文件
    db.close()
  }
}

function createCatalog(db: DatabaseSync, allowRestricted: boolean) {
  const userVersion = (db.prepare('PRAGMA user_version').get() as {
    user_version: number
  }).user_version
  if (userVersion !== SCHEMA_VERSION) {
    throw new Error(
      `词库格式不是 v${SCHEMA_VERSION}（user_version=${userVersion}），请用 deno task tagloom-catalog tree 重新生成`,
    )
  }
  const all = <T>(sql: string) => db.prepare(sql).all() as unknown as T[]

  const meta = new Map(
    all<{ key: string; value: string }>('SELECT key, value FROM meta').map((
      r,
    ) => [r.key, r.value]),
  )
  const version = `v${meta.get('schema_version') ?? 'unknown'}@${
    meta.get('generated_at') ?? 'unknown'
  }`
  const imports = all<
    { seq: number; name: string; revision: string; license: string }
  >(
    `SELECT DISTINCT seq, name, revision, license FROM import_log ORDER BY seq`,
  )
  const importName = new Map(imports.map((i) => [i.seq, i.name]))

  // ── 分类树：父分类 = 路径去掉最后一段 ──
  const categories = all<
    { path: string; label_en: string; label_ja: string; label_zh: string }
  >('SELECT path, label_en, label_ja, label_zh FROM category ORDER BY path')
    .map((c): Category => ({
      path: c.path,
      parent: null,
      labelZh: c.label_zh,
      labelEn: c.label_en,
      labelJa: c.label_ja,
    }))
  const byPath = new Map(categories.map((c) => [c.path, c]))
  const children = new Map<string | null, Category[]>()
  for (const c of categories) {
    const dot = c.path.lastIndexOf('.')
    const parent = dot > 0 ? c.path.slice(0, dot) : null
    c.parent = parent !== null && byPath.has(parent) ? parent : null
    const list = children.get(c.parent) ?? []
    list.push(c)
    children.set(c.parent, list)
  }
  const ancestorsOf = (path: string): Category[] => {
    const out: Category[] = []
    for (
      let c = byPath.get(path);
      c;
      c = c.parent === null ? undefined : byPath.get(c.parent)
    ) out.unshift(c)
    return out
  }
  const subtreeCache = new Map<string, Set<string>>()
  function subtree(paths: string[]): Set<string> {
    const key = paths.join('|')
    const hit = subtreeCache.get(key)
    if (hit) return hit
    const out = new Set<string>()
    const queue = paths.filter((p) => byPath.has(p))
    while (queue.length) {
      const p = queue.pop()!
      if (out.has(p)) continue
      out.add(p)
      for (const c of children.get(p) ?? []) queue.push(c.path)
    }
    subtreeCache.set(key, out)
    return out
  }
  // 分类名的索引：检索词命中分类名时，算作这个分类（含后代）里所有标签的部分匹配。
  // 按分类建索引，不给每个标签复制整条分类链，内存省很多
  const catWords = new Map<string, Set<string>>()
  const catCjk: { norm: string; path: string }[] = []
  for (const c of categories) {
    for (const label of [c.labelEn, c.labelJa, c.labelZh]) {
      for (const w of words(label)) {
        const set = catWords.get(w) ?? new Set()
        set.add(c.path)
        catWords.set(w, set)
      }
      const norm = normalizeTerm(label)
      if (norm.length >= 2 && CJK.test(norm)) {
        catCjk.push({ norm, path: c.path })
      }
    }
  }
  const sortedCatWords = [...catWords.keys()].sort()

  // ── 标签 ──
  const aliasRows = all<{ name: string; term: string }>(
    'SELECT DISTINCT name, term FROM tag_alias ORDER BY name, term',
  )
  const aliasesOf = new Map<string, string[]>()
  for (const r of aliasRows) {
    const list = aliasesOf.get(r.name) ?? []
    list.push(r.term)
    aliasesOf.set(r.name, list)
  }
  const sourcesOf = new Map<string, { source: string; key: string }[]>()
  for (
    const r of all<{ name: string; source: number; source_key: string }>(
      'SELECT name, source, source_key FROM tag_source ORDER BY name, source',
    )
  ) {
    const list = sourcesOf.get(r.name) ?? []
    list.push({ source: importName.get(r.source) ?? '', key: r.source_key })
    sourcesOf.set(r.name, list)
  }

  const tags: Tag[] = []
  const byName = new Map<string, Tag>()
  const terms: Term[] = []
  // 中日文包含检索的词：名称 / 别名，以及分类名、原始写法等（fuzzy）
  const cjkTerms: { norm: string; tagId: number; kind: Kind }[] = []
  // 规范化后的说明，下标 = 标签 id
  const noteNorms: string[] = []
  // 词 → 标签和字段权重，每项编码为 id * 16 + 权重（权重 < 16）
  const wordPostings = new Map<string, number[]>()

  for (
    const r of all<{
      name: string
      source_key: string
      category_path: string | null
      label_en: string
      label_ja: string
      label_zh: string
      post_count: number
      zh: string
      count: number | null
      notes: string
    }>(
      `SELECT name, source_key, category_path, label_en, label_ja, label_zh, post_count, zh, count, notes
       FROM tag${allowRestricted ? '' : ' WHERE restricted = 0'} ORDER BY name`,
    )
  ) {
    const id = tags.length
    const aliases = aliasesOf.get(r.name) ?? []
    const records = sourcesOf.get(r.name) ?? []
    const tag: Tag = {
      id,
      name: r.name,
      categoryPath: r.category_path ?? '',
      labelEn: r.label_en,
      labelJa: r.label_ja,
      labelZh: r.label_zh || r.zh,
      postCount: r.count ?? r.post_count,
      aliases,
      notes: r.notes,
      sources: [...new Set(records.map((s) => s.source))],
      sourceRecords: records,
      haystack: [],
    }
    tags.push(tag)
    byName.set(r.name, tag)
    noteNorms.push(r.notes ? normalizeTerm(r.notes) : '')

    // 词项：同一标签内同一个词同一种类只记一次
    const seen = new Set<string>()
    const own = new Set<string>()
    const addTerm = (value: string, kind: TermKind) => {
      const norm = normalizeTerm(value)
      if (!norm || seen.has(`${kind}\n${norm}`)) return
      seen.add(`${kind}\n${norm}`)
      own.add(norm)
      terms.push({ norm, tagId: id, kind })
      if (kind !== 'canonical' && CJK.test(norm)) {
        cjkTerms.push({ norm, tagId: id, kind })
      }
    }
    addTerm(r.name, 'canonical')
    for (const l of [r.label_en, r.label_ja, r.label_zh, r.zh]) {
      addTerm(l, 'label')
    }
    for (const a of aliases) addTerm(a, 'alias')
    tag.haystack = [...own]

    // 原始写法里的中日文（部分匹配）
    const keyNorm = normalizeTerm(r.source_key)
    if (keyNorm && CJK.test(keyNorm) && !own.has(keyNorm)) {
      cjkTerms.push({ norm: keyNorm, tagId: id, kind: 'fuzzy' })
    }

    // 词前缀：每个词在这个标签里取最高的字段权重
    const addWords = (value: string, weight: number) => {
      for (const w of words(value)) {
        const list = wordPostings.get(w)
        if (!list) {
          wordPostings.set(w, [id * 16 + weight])
          continue
        }
        const last = list[list.length - 1]
        if (Math.floor(last / 16) !== id) list.push(id * 16 + weight)
        else if (last % 16 < weight) list[list.length - 1] = id * 16 + weight
      }
    }
    addWords(r.name, WEIGHT.name)
    for (const a of aliases) addWords(a, WEIGHT.alias)
    for (const l of [r.label_en, r.label_ja, r.label_zh, r.zh]) {
      addWords(l, WEIGHT.label)
    }
  }

  terms.sort((a, b) => (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0))
  const termsByNorm = new Map<string, Term[]>()
  for (const t of terms) {
    const list = termsByNorm.get(t.norm)
    if (list) list.push(t)
    else termsByNorm.set(t.norm, [t])
  }
  const sortedWords = [...wordPostings.keys()].sort()

  // 二元组 → 中日文词（短词、靠前的标签在前，取前 CJK_GRAM_LIMIT 个）
  cjkTerms.sort((a, b) => a.norm.length - b.norm.length || a.tagId - b.tagId)
  const grams = new Map<string, number[]>()
  cjkTerms.forEach((t, i) => {
    for (const g of new Set(cjkBigrams(t.norm))) {
      const list = grams.get(g)
      if (list) list.push(i)
      else grams.set(g, [i])
    }
  })

  // 每个分类自己（不含后代）的标签
  const tagsByCategory = new Map<string, Tag[]>()
  for (const t of tags) {
    if (!t.categoryPath) continue
    const list = tagsByCategory.get(t.categoryPath) ?? []
    list.push(t)
    tagsByCategory.set(t.categoryPath, list)
  }
  const ownCount = (path: string) => tagsByCategory.get(path)?.length ?? 0
  // 分类（含后代）里的标签 id，按名称顺序
  const subtreeIdCache = new Map<string, number[]>()
  const subtreeTagIds = (path: string): number[] => {
    let hit = subtreeIdCache.get(path)
    if (!hit) {
      hit = [...subtree([path])].flatMap((p) =>
        (tagsByCategory.get(p) ?? []).map((t) => t.id)
      ).sort((a, b) => a - b)
      subtreeIdCache.set(path, hit)
    }
    return hit
  }
  const subtreeTagCount = (path: string) => {
    let n = 0
    for (const p of subtree([path])) n += ownCount(p)
    return n
  }

  function toTag(t: Tag): CatalogTag {
    const cat = byPath.get(t.categoryPath)
    return {
      canonical: t.name,
      labelZh: t.labelZh,
      labelEn: t.labelEn,
      labelJa: t.labelJa,
      aliases: t.aliases.slice(0, ALIAS_DISPLAY_LIMIT),
      postCount: t.postCount,
      notes: t.notes,
      categoryPath: t.categoryPath,
      categoryLabelZh: cat?.labelZh ?? '',
      sources: t.sources,
    }
  }

  // 全库检索：全部命中按 本字段分类 > 命中类型 > 相关度 > 频次 排好序
  function rankedHits(text: string, inPaths: string[]) {
    const input = normalizeTerm(text)
    const tokens = tokenize(text)
    const tokenText = tokens.join(' ')
    const cands = new Map<number, Cand>()
    const add = (
      id: number,
      kind: Kind,
      evidence: string,
      matchClass: number,
      relevance: number,
    ) => {
      const old = cands.get(id)
      if (
        !old || matchClass > old.matchClass ||
        (matchClass === old.matchClass && relevance > old.relevance)
      ) {
        cands.set(id, { id, kind, evidence, matchClass, relevance })
      }
    }

    // 1. 词项前缀：命中词必须完整出现在输入里
    for (const token of tokens) {
      const rows = token.length < 2
        ? termsByNorm.get(token) ?? []
        : withPrefix(terms, token, (t) => t.norm)
      for (const t of rows) {
        if (!matchesEvidence(tokenText, input, t.norm)) continue
        add(t.tagId, t.kind, t.norm, kindClass(t.kind), t.norm.length)
      }
    }

    // 2. 词前缀，按字段加权（每批最多 FTS_BATCH_LIMIT 个）
    const safe = tokens.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter((
      t,
    ) => t.length > 1)
    for (let i = 0; i < safe.length; i += FTS_BATCH_SIZE) {
      const batch = safe.slice(i, i + FTS_BATCH_SIZE)
      const score = new Map<number, number>()
      for (const token of batch) {
        const best = new Map<number, number>()
        for (const w of withPrefix(sortedWords, token, (x) => x)) {
          for (const p of wordPostings.get(w)!) {
            const id = Math.floor(p / 16)
            if ((best.get(id) ?? 0) < p % 16) best.set(id, p % 16)
          }
        }
        // 命中分类名：分类（含后代）里的标签都算
        for (const w of withPrefix(sortedCatWords, token, (x) => x)) {
          for (const path of catWords.get(w)!) {
            for (const id of subtreeTagIds(path)) {
              if (!best.has(id)) best.set(id, WEIGHT.category)
            }
          }
        }
        for (const [id, weight] of best) {
          score.set(id, (score.get(id) ?? 0) + weight)
        }
      }
      // 命中词：本批的检索词（不区分具体命中了哪个词）
      const evidence = batch.join(' / ')
      const top = [...score].sort((a, b) =>
        b[1] - a[1] || tags[b[0]].postCount - tags[a[0]].postCount
      ).slice(0, FTS_BATCH_LIMIT)
      for (const [id, s] of top) add(id, 'fuzzy', evidence, 0, s)
    }

    // 3. 中日文包含：输入包含完整的名称、别名（如两个字的「蓝发」）或分类名
    for (const g of cjkBigrams(input).slice(0, CJK_GRAM_CANDIDATE_LIMIT)) {
      for (const i of (grams.get(g) ?? []).slice(0, CJK_GRAM_LIMIT)) {
        const t = cjkTerms[i]
        if (t.norm.length < 2 || !input.includes(t.norm)) continue
        add(t.tagId, t.kind, t.norm, kindClass(t.kind), t.norm.length)
      }
    }
    // 分类名：每个分类（含后代）最多取 CJK_GRAM_LIMIT 个标签，按名称顺序
    for (const c of catCjk) {
      if (!input.includes(c.norm)) continue
      for (const id of subtreeTagIds(c.path).slice(0, CJK_GRAM_LIMIT)) {
        add(id, 'fuzzy', c.norm, 0, c.norm.length)
      }
    }

    // 4. 说明：包含每个检索词（拉丁文词至少 2 个字符）；逐条扫描，7.5 万条约 5 ms
    const noteTokens = tokens.filter((t) => CJK.test(t) || t.length > 1)
    if (noteTokens.length) {
      const relevance = noteTokens.join('').length
      const found: number[] = []
      noteNorms.forEach((n, id) => {
        if (n && !cands.has(id) && noteTokens.every((t) => n.includes(t))) {
          found.push(id)
        }
      })
      found.sort((a, b) => tags[b].postCount - tags[a].postCount)
      const evidence = noteTokens.join(' ')
      for (const id of found.slice(0, NOTE_LIMIT)) {
        add(id, 'note', evidence, -1, relevance)
      }
    }

    const field = subtree(inPaths)
    const rows = [...cands.values()].map((c) => {
      const tag = tags[c.id]
      return { c, tag, inField: field.has(tag.categoryPath) }
    })
    rows.sort((a, b) =>
      Number(b.inField) - Number(a.inField) ||
      b.c.matchClass - a.c.matchClass ||
      b.c.relevance - a.c.relevance ||
      b.tag.postCount - a.tag.postCount ||
      (a.tag.name < b.tag.name ? -1 : a.tag.name > b.tag.name ? 1 : 0)
    )
    return { rows, input }
  }

  function searchPage(
    text: string,
    inPaths: string[],
    offset: number,
    limit: number,
  ): { items: CatalogHit[]; total: number } {
    const { rows, input } = rankedHits(text, inPaths)
    return {
      items: rows.slice(offset, offset + limit).map(({ c, tag, inField }) => ({
        ...toTag(tag),
        // 命中词等于整段输入才算精确；只命中其中一部分，或词前缀 / 部分匹配 / 说明得到的，都是部分匹配
        match: c.kind !== 'fuzzy' && c.kind !== 'note' &&
            normalizeTerm(c.evidence) === input
          ? c.kind
          : 'partial',
        evidence: c.evidence,
        inField,
        ...(c.kind === 'note' ? { byNote: true as const } : {}),
      })),
      total: rows.length,
    }
  }

  function search(
    text: string,
    limit: number,
    inPaths: string[],
  ): CatalogHit[] {
    return searchPage(text, inPaths, 0, limit).items
  }

  // 分类（含后代）内的标签（q 非空时按名称 / 别名过滤）：一页 + 总数
  function tagsIn(
    paths: Set<string>,
    q: string,
    limit: number,
    offset: number,
  ): { rows: Tag[]; total: number } {
    const qn = normalizeTerm(q)
    let rows = [...paths].flatMap((p) => tagsByCategory.get(p) ?? [])
    if (qn) rows = rows.filter((t) => t.haystack.some((h) => h.includes(qn)))
    const exact = (t: Tag) =>
      qn !== '' && (t.name === qn || normalizeTerm(t.labelZh) === qn)
    rows.sort((a, b) =>
      Number(exact(b)) - Number(exact(a)) ||
      b.postCount - a.postCount ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    )
    return { rows: rows.slice(offset, offset + limit), total: rows.length }
  }

  function listInCategories(
    paths: string[],
    q: string,
    limit: number,
  ): CatalogTag[] {
    return tagsIn(subtree(paths), q, limit, 0).rows.map(toTag)
  }

  function toCategory(c: Category): CatalogCategory {
    return {
      path: c.path,
      labelZh: c.labelZh,
      labelEn: c.labelEn,
      labelJa: c.labelJa,
      tagCount: subtreeTagCount(c.path),
    }
  }

  function tagDetail(canonical: string): CatalogTagDetail | null {
    const tag = byName.get(normalizeTerm(canonical))
    if (!tag) return null
    return {
      ...toTag(tag),
      categoryTrail: tag.categoryPath
        ? ancestorsOf(tag.categoryPath).map((c) => ({
          path: c.path,
          labelZh: c.labelZh,
          labelEn: c.labelEn,
          labelJa: c.labelJa,
        }))
        : [],
      categoryOwnCount: tag.categoryPath ? ownCount(tag.categoryPath) : 0,
      sourceRecords: tag.sourceRecords,
    }
  }

  // 核对一个名字：canonical 完全一致优先；否则按三语名称 / 别名找；都没有时给检索结果作参考
  function lookup(name: string): CatalogLookup {
    const norm = normalizeTerm(name)
    if (!norm) return { status: 'none', tags: [], suggestions: [] }
    const exact = byName.get(norm)
    if (exact) return { status: 'exact', tags: [toTag(exact)], suggestions: [] }
    const hits = (termsByNorm.get(norm) ?? []).filter((t) =>
      t.kind !== 'canonical'
    )
    const found = [...new Set(hits.map((h) => h.tagId))].map((id) => tags[id])
    if (!found.length) {
      return {
        status: 'none',
        tags: [],
        suggestions: searchPage(name, [], 0, LOOKUP_SUGGESTIONS).items,
      }
    }
    const list = found.sort((a, b) => b.postCount - a.postCount).map(toTag)
    if (list.length > 1) {
      return { status: 'ambiguous', tags: list, suggestions: [] }
    }
    return {
      status: hits.some((h) => h.kind === 'alias') &&
          !hits.some((h) => h.kind === 'label')
        ? 'alias'
        : 'label',
      tags: list,
      suggestions: [],
    }
  }

  function category(
    path: string,
    q: string,
    limit: number,
    offset: number,
  ): CatalogCategoryPage | null {
    const self = path ? byPath.get(path) : undefined
    if (path && !self) return null
    const ancestors = self
      ? ancestorsOf(self.path).slice(0, -1).map((c) => ({
        path: c.path,
        labelZh: c.labelZh,
      }))
      : []
    // 没有标签的子分类（例如未开放受限内容时的 explicit）不列出
    const kids = (children.get(self?.path ?? null) ?? [])
      .map(toCategory)
      .filter((c) => c.tagCount > 0)
      .sort((a, b) => b.tagCount - a.tagCount || (a.path < b.path ? -1 : 1))
    const { rows, total } = self
      ? tagsIn(subtree([self.path]), q, limit, offset)
      : { rows: [], total: 0 }
    return {
      category: self ? toCategory(self) : null,
      ancestors,
      children: kids,
      tags: rows.map(toTag),
      total,
      offset,
    }
  }

  // 自然语言粗筛的内存索引：第一次用到时才建
  let textIndex: TextMatchIndex | null = null
  function matchText(
    text: string,
    limit: number,
    options: { offset?: number; tiers?: TextMatchTier[] } = {},
  ): TextMatchResult {
    textIndex ??= buildTextMatchIndex(
      tags.map((t) => ({
        id: t.id,
        canonical: t.name,
        postCount: t.postCount,
      })),
      terms.map((t) => ({ tagId: t.tagId, term: t.norm })),
      categories.map((c) => ({
        path: c.path,
        labels: [c.labelEn, c.labelJa, c.labelZh].map(normalizeTerm)
          .filter(Boolean),
      })),
    )
    const raw = runTextMatch(textIndex, normalizeTerm(text))
    const tiers = options.tiers
    const found = tiers
      ? raw.candidates.filter((c) => tiers.includes(c.tier))
      : raw.candidates
    const offset = options.offset ?? 0
    return {
      candidates: found.slice(offset, offset + limit).map((c) => ({
        ...toTag(tags[c.tagId]),
        tier: c.tier,
        hits: c.hits,
      })),
      total: found.length,
      categoryHints: raw.categoryHints.map((h) => ({
        ...h,
        labelZh: byPath.get(h.path)?.labelZh ?? '',
      })),
      unmatched: raw.unmatched,
    }
  }

  const status: CatalogStatus = {
    available: true,
    version,
    tagCount: tags.length,
    sources: imports.map(({ name, revision, license }) => ({
      name,
      revision,
      license,
    })),
  }

  return {
    status: () => status,
    version: () => version,
    search,
    listInCategories,
    matchText,
    searchPage,
    lookup,
    category,
    tagDetail,
    close: () => {},
  }
}

function kindClass(kind: Kind): number {
  return kind === 'canonical'
    ? 3
    : kind === 'alias'
    ? 2
    : kind === 'label'
    ? 1
    : kind === 'note'
    ? -1
    : 0
}

const CJK = /[㐀-鿿豈-﫿぀-ヿ]/u

// 中日文：输入包含完整命中词；拉丁文：命中词是输入里的完整词序列
function matchesEvidence(tokenText: string, input: string, evidence: string) {
  if (!evidence) return false
  if (CJK.test(evidence)) {
    return evidence.length >= 2 && input.includes(evidence)
  }
  const escaped = evidence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^| )${escaped}(?= |$)`, 'u').test(tokenText)
}

function cjkBigrams(value: string): string[] {
  const grams = new Set<string>()
  for (
    const m of value.matchAll(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu,
    )
  ) {
    const ch = Array.from(m[0])
    for (let i = 0; i + 1 < ch.length; i++) grams.add(ch[i] + ch[i + 1])
  }
  return [...grams]
}
