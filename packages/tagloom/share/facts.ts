// 事实 → 检索候选 → 人工确认 / 拒绝 → 锁定。纯函数，返回新对象，不修改入参。
// - 精确命中不等于已确认；所有候选初始都是 pending，只有用户操作才会确认。
// - 拒绝候选不删除事实；无匹配不等于设定无效。
// - 锁定的事实不被重新检索改写。
import type { CatalogHit } from './catalog.ts'
import { tagRefOf } from './catalog.ts'
import {
  type Candidate,
  type Decision,
  type Fact,
  newId,
  type PromptItem,
  type Segment,
  type TagRef,
  userOrigin,
} from './model.ts'

export function addFact(
  seg: Segment,
  input: { field: string; text: string; sourceQuote?: string },
): Segment {
  const fact: Fact = {
    id: newId(),
    field: input.field,
    text: input.text.trim(),
    sourceQuote: (input.sourceQuote ?? '').trim(),
    status: 'pending',
    locked: false,
    candidates: [],
    searchedAt: null,
    searchVerified: false,
  }
  return { ...seg, facts: [...seg.facts, fact] }
}

function mapFact(seg: Segment, factId: string, fn: (f: Fact) => Fact): Segment {
  return { ...seg, facts: seg.facts.map((f) => (f.id === factId ? fn(f) : f)) }
}

export function updateFact(
  seg: Segment,
  factId: string,
  patch: Partial<Pick<Fact, 'text' | 'sourceQuote' | 'field'>>,
): Segment {
  return mapFact(seg, factId, (f) => (f.locked ? f : { ...f, ...patch }))
}

// 删除事实：它加入的条目保留，只断开来源关联
export function removeFact(seg: Segment, factId: string): Segment {
  return {
    ...seg,
    facts: seg.facts.filter((f) => f.id !== factId),
    items: seg.items.map((i) =>
      i.factId === factId ? { ...i, factId: null } : i
    ),
  }
}

export function setFactLocked(
  seg: Segment,
  factId: string,
  locked: boolean,
): Segment {
  return mapFact(seg, factId, (f) => ({ ...f, locked }))
}

export function setFactStatus(
  seg: Segment,
  factId: string,
  status: Decision,
): Segment {
  return mapFact(seg, factId, (f) => (f.locked ? f : { ...f, status }))
}

// 检索结果写入事实：已确认 / 已拒绝的候选保留，待定的换成新结果。锁定的事实不变。
// verified=false 表示没有经过数据库核查（词库不可用），不能当作「无匹配」。
export function applySearch(
  seg: Segment,
  factId: string,
  hits: CatalogHit[],
  catalogVersion: string | null,
  now: number,
): Segment {
  return mapFact(seg, factId, (f) => {
    if (f.locked) return f
    const decided = f.candidates.filter((c) => c.decision !== 'pending')
    const decidedKeys = new Set(decided.map(candidateKey))
    const fresh: Candidate[] = []
    for (const hit of hits) {
      const tags = [tagRefOf(hit, catalogVersion)]
      const key = tags.map((t) => t.canonical).join('|')
      if (decidedKeys.has(key)) continue
      fresh.push({
        id: newId(),
        tags,
        match: hit.match,
        evidence: hit.evidence,
        reason: hit.inField
          ? `命中「${hit.evidence}」，属于本字段的词库分类 ${hit.categoryPath}`
          : `命中「${hit.evidence}」，词库分类 ${hit.categoryPath} 不在本字段的参考范围内`,
        decision: 'pending',
      })
    }
    return {
      ...f,
      candidates: [...decided, ...fresh],
      searchedAt: now,
      searchVerified: catalogVersion !== null,
    }
  })
}

const candidateKey = (c: Candidate) => c.tags.map((t) => t.canonical).join('|')

// 确认候选：候选标为 confirmed，标签作为勾选的条目加入最终 Prompt（已有同名条目则只勾选），事实标为已确认。
// 拒绝候选：候选标为 rejected，并移除它之前加入的条目；事实本身保留。
export function decideCandidate(
  seg: Segment,
  factId: string,
  candidateId: string,
  decision: Decision,
): Segment {
  const fact = seg.facts.find((f) => f.id === factId)
  const cand = fact?.candidates.find((c) => c.id === candidateId)
  if (!fact || !cand || fact.locked) return seg
  let items: PromptItem[] = seg.items
  const sameTag = (i: PromptItem, t: TagRef) =>
    i.source.kind === 'catalog' && i.source.tag.canonical === t.canonical
  if (decision === 'confirmed') {
    for (const tag of cand.tags) {
      const existing = items.find((i) => sameTag(i, tag))
      if (existing) {
        // 已有同一标签的条目（如之前手选过）：勾选并补上事实关联，不重复添加
        items = items.map((i) =>
          i.id === existing.id
            ? { ...i, included: true, factId: i.factId ?? factId }
            : i
        )
      } else {
        items = [...items, {
          ...userOrigin(),
          id: newId(),
          source: { kind: 'catalog', tag },
          field: fact.field,
          text: tag.canonical,
          included: true,
          factId,
        }]
      }
    }
  } else {
    // 只移除由这个事实加入的条目；手选的同名条目不动
    items = items.filter((i) =>
      !(i.factId === factId && cand.tags.some((t) => sameTag(i, t)))
    )
  }
  const candidates = fact.candidates.map((c) =>
    c.id === candidateId ? { ...c, decision } : c
  )
  const status: Decision = candidates.some((c) => c.decision === 'confirmed')
    ? 'confirmed'
    : fact.status === 'confirmed'
    ? 'pending'
    : fact.status
  return {
    ...seg,
    items,
    facts: seg.facts.map((f) =>
      f.id === factId ? { ...f, candidates, status } : f
    ),
  }
}

// 档案修改后，摘录的原文片段不再出现：提取依据已变化
export function isSourceStale(fact: Fact, profile: string): boolean {
  return fact.sourceQuote !== '' && !profile.includes(fact.sourceQuote)
}
