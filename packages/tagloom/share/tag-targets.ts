// 全局标签搜索的「加到哪个分类」：按词库分类路径推断目标分类（及记录用的选词字段）。
// 推断只是建议，用户可以改成任意分类；词库里约三分之二的分类（物品、场景、构图等）没有对应分类，
// 这时没有建议，由用户手动选择。
import {
  ACTION_SEGMENT,
  allFieldKeys,
  BASE_SEGMENTS,
  COMBO_SEGMENTS,
  EXPRESSION_SEGMENT,
  fieldDef,
  type SegmentDef,
} from './fields.ts'

export type TagTargetScope = 'base' | 'costume' | 'state'

export interface TagTarget {
  // 'base.hair' / 'costume.top' / 'state.expression'
  key: string
  scope: TagTargetScope
  segment: string
  // 记在条目上的选词字段（只是来源信息，不影响输出）
  field: string
  label: string
}

// 神态 / 动作字段在 fields.ts 里是「文本优先」、没有词库分类；全局搜索时按下面的分类建议到状态里
const STATE_CATEGORY_HINTS: Record<'expression' | 'action', string[]> = {
  expression: ['dynamics.expression'],
  action: ['dynamics.action', 'dynamics.pose', 'dynamics.interaction'],
}

const SCOPE_LABEL: Record<TagTargetScope, string> = {
  base: 'Base',
  costume: '组合',
  state: '状态',
}

interface Candidate {
  target: TagTarget
  paths: string[]
  optional: boolean
}

function candidatesOf(scope: TagTargetScope, def: SegmentDef): Candidate[] {
  const base = {
    key: `${scope}.${def.key}`,
    scope,
    segment: def.key,
    label: `${SCOPE_LABEL[scope]} · ${def.label}`,
  }
  const hints = scope === 'state'
    ? STATE_CATEGORY_HINTS[def.key as 'expression' | 'action']
    : null
  if (hints) {
    return [{
      target: { ...base, field: def.fields[0].key },
      paths: hints,
      optional: false,
    }]
  }
  return def.fields.map((f) => ({
    target: { ...base, field: f.key },
    paths: f.categoryPaths,
    optional: f.optional,
  }))
}

const CANDIDATES: Candidate[] = [
  ...BASE_SEGMENTS.flatMap((d) => candidatesOf('base', d)),
  ...COMBO_SEGMENTS.flatMap((d) => candidatesOf('costume', d)),
  ...[EXPRESSION_SEGMENT, ACTION_SEGMENT].flatMap((d) =>
    candidatesOf('state', d)
  ),
]

// 每件衣物都有的部件字段（袖型、图案、材质等）出现在多个分类里，靠它判断不出是哪件衣物，
// 不参与建议：这类细节标签由用户手动选分类
const SHARED_FIELDS = (() => {
  const count = new Map<string, number>()
  for (const c of CANDIDATES) {
    count.set(c.target.field, (count.get(c.target.field) ?? 0) + 1)
  }
  return new Set([...count].filter(([, n]) => n > 1).map(([field]) => field))
})()

// 代码里写死的所有词库分类路径（选词字段 + 状态建议）。生成词库时逐个校验，缺了就中止
export function referencedCategoryPaths(): string[] {
  const paths = new Set(CANDIDATES.flatMap((c) => c.paths))
  for (const key of allFieldKeys()) {
    for (const p of fieldDef(key)?.categoryPaths ?? []) paths.add(p)
  }
  return [...paths].sort()
}

// 所有可选的目标分类（手动选择用），每个分类用它的第一个字段记录来源
export const TAG_TARGETS: TagTarget[] = (() => {
  const seen = new Set<string>()
  return CANDIDATES.map((c) => c.target).filter((t) =>
    seen.has(t.key) ? false : (seen.add(t.key), true)
  )
})()

export function tagTarget(key: string): TagTarget | undefined {
  return TAG_TARGETS.find((t) => t.key === key)
}

// 词库分类路径 → 建议的目标分类，最贴切的在前：路径匹配越长越靠前，同样长时常用字段优先。
// 每个分类只出现一次；没有对应分类（或只对应各衣物共有的部件字段）时返回空数组。
export function suggestTagTargets(categoryPath: string): TagTarget[] {
  if (!categoryPath) return []
  const scored: { target: TagTarget; length: number; optional: boolean }[] = []
  for (const c of CANDIDATES) {
    if (SHARED_FIELDS.has(c.target.field)) continue
    const length = Math.max(
      0,
      ...c.paths
        .filter((p) => categoryPath === p || categoryPath.startsWith(`${p}.`))
        .map((p) => p.length),
    )
    if (length > 0) {
      scored.push({ target: c.target, length, optional: c.optional })
    }
  }
  // sort 是稳定的：同分时保持分类在界面里的顺序
  scored.sort((a, b) =>
    b.length - a.length || Number(a.optional) - Number(b.optional)
  )
  const seen = new Set<string>()
  return scored.map((s) => s.target).filter((t) =>
    seen.has(t.key) ? false : (seen.add(t.key), true)
  )
}

// 分类输入框的下拉建议：这个分类各字段对应的词库分类路径（神态 / 动作用上面的提示分类）
export function segmentCategoryPaths(def: SegmentDef): string[] {
  const hints = def === EXPRESSION_SEGMENT || def === ACTION_SEGMENT
    ? STATE_CATEGORY_HINTS[def.key as 'expression' | 'action']
    : []
  return [...new Set([...def.fields.flatMap((f) => f.categoryPaths), ...hints])]
}

// 词库标签加进这个分类时记录的选词字段：词库分类路径匹配最长的字段，匹配不上用第一个字段
export function segmentFieldFor(def: SegmentDef, categoryPath: string): string {
  let best = def.fields[0].key
  let length = 0
  for (const f of def.fields) {
    for (const p of f.categoryPaths) {
      if (
        p.length > length &&
        (categoryPath === p || categoryPath.startsWith(`${p}.`))
      ) {
        best = f.key
        length = p.length
      }
    }
  }
  return best
}
