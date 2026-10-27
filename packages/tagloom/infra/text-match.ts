// 自然语言粗筛：从一段描述里找出「可能相关」的词库标签，宁多勿漏，交给用户或 AI 再挑。
// 纯内存、不依赖 SQLite（索引由 sqlite-catalog 从 tag_terms 等表读出后构建），便于用小样本测试。
// 每个候选都必须能指出对应原文里的哪一段（hits），找不到依据的不收——这是挡住「完全不相关」的底线。
//
// 规则（按可信程度分层）：
//   exact    词库词原样出现：中日文子串；英文完整词序列（按词干比较，holding / hold 视为同一词）
//   loose    中文词的字按顺序出现在同一小句、中间最多隔 GAP 个字（撑着伞 → 撑伞）；
//            英文标签的实词全部出现在同一小句、顺序不限（long blue hair → blue hair）
//   related  名字里包含已命中的词：词少见（≤ RARE_LIMIT 个标签含它）时全收，常见词要同时含第二个命中词；
//            英文单个词要本身就是命中的标签（umbrella），形容词（long、blue）单独出现不扩展
//   single   单个汉字的词：只在没被多字命中覆盖的位置、且不在停用字表里
// 分类名（表情、发型…）只记成 categoryHints，不展开成标签。
import type { TextMatchHit, TextMatchTier } from '../share/mod.ts'

export interface MatchTermRow {
  tagId: number
  // normalizeTerm 后的词
  term: string
}

export interface MatchTagRow {
  id: number
  canonical: string
  postCount: number
}

export interface MatchCategoryRow {
  path: string
  labels: string[]
}

export interface TextMatchIndex {
  cjkByFirst: Map<string, { term: string; tagIds: number[] }[]>
  latinByFirst: Map<
    string,
    { stems: string[]; term: string; tagIds: number[] }[]
  >
  // canonical 的实词词干 → 标签
  stemTags: Map<string, number[]>
  tagStems: Map<number, string[]>
  // 每个标签全部中日文词（换行连接），related 规则做子串查找
  tagCjk: { id: number; text: string }[]
  postCount: Map<number, number>
  categories: { path: string; cjk: string[]; latin: string[][] }[]
}

export interface RawTextMatch {
  candidates: { tagId: number; tier: TextMatchTier; hits: TextMatchHit[] }[]
  categoryHints: { path: string; text: string }[]
  unmatched: string[]
}

const GAP = 2
const RARE_LIMIT = 60
const MAX_HITS = 5

const TIER_RANK: Record<TextMatchTier, number> = {
  exact: 3,
  loose: 2,
  related: 1,
  single: 0,
}

const STOPWORDS = new Set(
  ('a an the of in on at to with and or for by from is are was were be been being am ' +
    'her his she he it its this that these those i you we they my your our their me him them ' +
    'as but so very really some has have had do does did into onto than then just also ' +
    'there here who which what when where while')
    .split(' '),
)

// 单字词里容易误中的字（多为虚词或常见构词字）
const STOP_CHARS = new Set(
  Array.from('不与人点高表流打玩元老初结信累图圈卡门光线堆圆管'),
)

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const CLAUSE_SPLIT = /[\n,.;:!?，。、；：！？()（）「」『』【】"“”'‘’\[\]{}]+/u
const LATIN_WORD = /[\p{Script=Latin}\p{N}]+/gu

// 粗糙的英文词干：两边用同一个函数，只要一致即可（smile / smiling / smiled → smil）
export function stem(word: string): string {
  let w = word
  if (w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (/(ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2)
  let suffix = false
  if (w.endsWith('ing') && w.length > 5) {
    w = w.slice(0, -3)
    suffix = true
  } else if (w.endsWith('ed') && w.length > 4) {
    w = w.slice(0, -2)
    suffix = true
  } else if (/[^su]s$/.test(w) && !w.endsWith('is')) {
    w = w.slice(0, -1)
  }
  // sitting → sitt → sit；running → run
  if (suffix && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss)$/.test(w)) {
    w = w.slice(0, -1)
  }
  if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1)
  return w
}

const wordsOf = (s: string) => s.match(LATIN_WORD) ?? []
const contentStems = (s: string) => [
  ...new Set(wordsOf(s).filter((w) => !STOPWORDS.has(w)).map(stem)),
]

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

export function buildTextMatchIndex(
  tags: MatchTagRow[],
  terms: MatchTermRow[],
  categories: MatchCategoryRow[],
): TextMatchIndex {
  const byTerm = new Map<string, Set<number>>()
  for (const t of terms) {
    if (!t.term) continue
    const set = byTerm.get(t.term) ?? new Set()
    set.add(t.tagId)
    byTerm.set(t.term, set)
  }

  const cjkByFirst: TextMatchIndex['cjkByFirst'] = new Map()
  const latinByFirst: TextMatchIndex['latinByFirst'] = new Map()
  const cjkOfTag = new Map<number, string[]>()
  for (const [term, ids] of byTerm) {
    const tagIds = [...ids]
    if (CJK_CHAR.test(term)) {
      push(cjkByFirst, term[0], { term, tagIds })
      for (const id of tagIds) push(cjkOfTag, id, term)
      continue
    }
    const words = wordsOf(term)
    // 只有符号（:d、^ ^）或全是虚词的词不参与
    if (!words.length || words.every((w) => STOPWORDS.has(w))) continue
    const stems = words.map(stem)
    push(latinByFirst, stems[0], { stems, term, tagIds })
  }

  const stemTags: TextMatchIndex['stemTags'] = new Map()
  const tagStems: TextMatchIndex['tagStems'] = new Map()
  for (const tag of tags) {
    const stems = contentStems(tag.canonical)
    if (!stems.length) continue
    tagStems.set(tag.id, stems)
    for (const s of stems) push(stemTags, s, tag.id)
  }

  return {
    cjkByFirst,
    latinByFirst,
    stemTags,
    tagStems,
    tagCjk: [...cjkOfTag].map(([id, list]) => ({ id, text: list.join('\n') })),
    postCount: new Map(tags.map((t) => [t.id, t.postCount])),
    categories: categories.map((c) => ({
      path: c.path,
      cjk: c.labels.filter((l) => CJK_CHAR.test(l) && l.length >= 2),
      latin: c.labels.filter((l) => !CJK_CHAR.test(l))
        .map((l) => wordsOf(l).map(stem))
        .filter((s) => s.length && !(s.length === 1 && STOPWORDS.has(s[0]))),
    })),
  }
}

interface Clause {
  text: string
  // text 在整段输入里的起点
  start: number
}

function clausesOf(input: string): Clause[] {
  const out: Clause[] = []
  let pos = 0
  for (const part of input.split(CLAUSE_SPLIT)) {
    const start = input.indexOf(part, pos)
    pos = start + part.length
    if (part.trim()) out.push({ text: part, start })
  }
  return out
}

// 中文词按顺序出现、每处最多隔 GAP 个字；返回结束位置（不含），找不到返回 -1
function gappedEnd(text: string, from: number, term: string): number {
  let at = from + 1
  for (let k = 1; k < term.length; k++) {
    const limit = Math.min(text.length, at + GAP + 1)
    let found = -1
    for (let j = at; j < limit; j++) {
      if (text[j] === term[k]) {
        found = j
        break
      }
    }
    if (found < 0) return -1
    at = found + 1
  }
  return at
}

export function matchText(index: TextMatchIndex, input: string): RawTextMatch {
  const found = new Map<
    number,
    { tier: TextMatchTier; hits: TextMatchHit[] }
  >()
  const add = (tagId: number, tier: TextMatchTier, hit: TextMatchHit) => {
    const old = found.get(tagId)
    if (!old) {
      found.set(tagId, { tier, hits: [hit] })
      return
    }
    if (TIER_RANK[tier] > TIER_RANK[old.tier]) old.tier = tier
    if (
      old.hits.length < MAX_HITS &&
      !old.hits.some((h) => h.term === hit.term && h.text === hit.text)
    ) old.hits.push(hit)
  }
  const covered = new Uint8Array(input.length)
  const cover = (from: number, to: number) => covered.fill(1, from, to)
  // related 规则的种子：命中的中文词、英文词干（按小句）
  const hitCjk = new Map<string, number[]>()
  const hints = new Map<string, string>()

  const clauses = clausesOf(input)
  clauses.forEach((clause, ci) => {
    const { text, start } = clause

    // —— 中日文：exact / loose / single ——
    const exactTerms = new Set<string>()
    const exactSpans: [number, number][] = []
    const singles: { i: number; term: string; tagIds: number[] }[] = []
    for (let i = 0; i < text.length; i++) {
      for (const e of index.cjkByFirst.get(text[i]) ?? []) {
        if (e.term.length === 1) {
          if (!STOP_CHARS.has(e.term)) singles.push({ i, ...e })
        } else if (text.startsWith(e.term, i)) {
          exactTerms.add(e.term)
          exactSpans.push([i, i + e.term.length])
          cover(start + i, start + i + e.term.length)
          push(hitCjk, e.term, ci)
          for (const id of e.tagIds) {
            add(id, 'exact', { rule: 'exact', term: e.term, text: e.term })
          }
        }
      }
    }
    for (let i = 0; i < text.length; i++) {
      for (const e of index.cjkByFirst.get(text[i]) ?? []) {
        if (e.term.length < 2 || exactTerms.has(e.term)) continue
        const end = gappedEnd(text, i, e.term)
        if (end < 0) continue
        // 整段落在另一个原样命中的词里面（黑框眼镜 → 黑眼）：是跨词拼出来的，不算
        if (exactSpans.some(([a, b]) => a <= i && end <= b)) continue
        cover(start + i, start + end)
        push(hitCjk, e.term, ci)
        for (const id of e.tagIds) {
          add(id, 'loose', {
            rule: 'gap',
            term: e.term,
            text: text.slice(i, end),
          })
        }
      }
    }
    for (const s of singles) {
      if (covered[start + s.i]) continue
      for (const id of s.tagIds) {
        add(id, 'single', { rule: 'single', term: s.term, text: s.term })
      }
    }

    // —— 英文：exact（词序列）、loose（实词齐全）、related ——
    const words = [...text.matchAll(LATIN_WORD)].map((m) => ({
      word: m[0],
      stem: stem(m[0]),
      at: start + m.index!,
    }))
    const usedStems = new Set<string>()
    // 单个词本身就是命中的标签（umbrella、sailor）：可以按它扩展 related
    const tagStemsHit = new Set<string>()
    for (let i = 0; i < words.length; i++) {
      for (const e of index.latinByFirst.get(words[i].stem) ?? []) {
        if (i + e.stems.length > words.length) continue
        if (!e.stems.every((s, k) => words[i + k].stem === s)) continue
        const last = words[i + e.stems.length - 1]
        cover(words[i].at, last.at + last.word.length)
        e.stems.forEach((s) => usedStems.add(s))
        if (e.stems.length === 1) tagStemsHit.add(e.stems[0])
        const span = input.slice(words[i].at, last.at + last.word.length)
        for (const id of e.tagIds) {
          add(id, 'exact', { rule: 'exact', term: e.term, text: span })
        }
      }
    }
    const content = words.filter((w) => !STOPWORDS.has(w.word))
    const clauseStems = new Map(content.map((w) => [w.stem, w]))
    const counts = new Map<number, number>()
    for (const s of clauseStems.keys()) {
      for (const id of index.stemTags.get(s) ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
    for (const [id, n] of counts) {
      const stems = index.tagStems.get(id)!
      const matched = stems.filter((s) => clauseStems.has(s))
      const span = matched.map((s) => clauseStems.get(s)!.word).join(' ')
      if (n === stems.length) {
        matched.forEach((s) => usedStems.add(s))
        add(id, 'loose', { rule: 'words', term: span, text: span })
      } else if (
        n >= 2 ||
        matched.some((s) =>
          tagStemsHit.has(s) && index.stemTags.get(s)!.length <= RARE_LIMIT
        )
      ) {
        add(id, 'related', { rule: 'contains', term: span, text: span })
      }
    }
    for (const w of content) {
      if (usedStems.has(w.stem)) cover(w.at, w.at + w.word.length)
    }

    // —— 分类名：只提示，不展开 ——
    for (const c of index.categories) {
      for (const label of c.cjk) {
        const at = text.indexOf(label)
        if (at < 0) continue
        cover(start + at, start + at + label.length)
        if (!hints.has(c.path)) hints.set(c.path, label)
      }
      for (const stems of c.latin) {
        const at = words.findIndex((_, i) =>
          stems.every((s, k) => words[i + k]?.stem === s)
        )
        if (at < 0) continue
        const last = words[at + stems.length - 1]
        cover(words[at].at, last.at + last.word.length)
        if (!hints.has(c.path)) {
          hints.set(
            c.path,
            words.slice(at, at + stems.length).map((w) => w.word).join(' '),
          )
        }
      }
    }
  })

  // —— 中日文 related：名字里包含命中的词 ——
  const holders = new Map<string, number[]>()
  for (const term of hitCjk.keys()) {
    holders.set(
      term,
      index.tagCjk.filter((t) => t.text.includes(term)).map((t) => t.id),
    )
  }
  for (const [term, ids] of holders) {
    if (ids.length <= RARE_LIMIT) {
      for (const id of ids) {
        add(id, 'related', { rule: 'contains', term, text: term })
      }
      continue
    }
    // 常见词：同一小句里另一个命中词也出现在这个标签的名字里
    const clauseSet = new Set(hitCjk.get(term))
    const partners = [...hitCjk].filter(([t, cs]) =>
      t !== term && !t.includes(term) && !term.includes(t) &&
      cs.some((c) => clauseSet.has(c))
    ).map(([t]) => t)
    if (!partners.length) continue
    const text = new Map(index.tagCjk.map((t) => [t.id, t.text]))
    for (const id of ids) {
      const p = partners.find((x) => text.get(id)!.includes(x))
      if (p) {
        add(id, 'related', {
          rule: 'contains',
          term: `${term} + ${p}`,
          text: `${term} + ${p}`,
        })
      }
    }
  }

  const candidates = [...found].map(([tagId, v]) => ({ tagId, ...v }))
  candidates.sort((a, b) =>
    TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
    (index.postCount.get(b.tagId) ?? 0) - (index.postCount.get(a.tagId) ?? 0)
  )
  return {
    candidates,
    categoryHints: [...hints].map(([path, text]) => ({ path, text })),
    unmatched: unmatchedRuns(input, covered),
  }
}

// 没被任何 exact / loose 命中覆盖的片段（去掉虚词和单字）
function unmatchedRuns(input: string, covered: Uint8Array): string[] {
  const out: string[] = []
  let run = ''
  const flush = () => {
    const parts = run.split(CLAUSE_SPLIT).flatMap((p) => p.split(' '))
      .map((p) => p.trim()).filter((p) =>
        p && !STOPWORDS.has(p) &&
        (CJK_CHAR.test(p) ? p.length >= 2 : p.length >= 2)
      )
    out.push(...parts)
    run = ''
  }
  for (let i = 0; i < input.length; i++) {
    if (covered[i]) flush()
    else run += input[i]
  }
  flush()
  return [...new Set(out)]
}
