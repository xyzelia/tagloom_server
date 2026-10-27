// 分类内的条目操作：选用词库 tag / 自创标签、添加文本、开关、改写、排序、删除；字段状态。纯函数。
import {
  type CustomTag,
  type FieldState,
  newId,
  type OriginInfo,
  type PromptItem,
  type Segment,
  type TagRef,
  userOrigin,
} from './model.ts'

function addItem(seg: Segment, item: PromptItem): Segment {
  return { ...seg, items: [...seg.items, item] }
}

// 选用词库 tag：同一分类已有同一个 canonical 的条目时，只把它重新勾选，不重复添加。
// field = null：不分字段的位置（场景条目）
export function pickCatalogTag(
  seg: Segment,
  field: string | null,
  tag: TagRef,
  by: OriginInfo = userOrigin(),
  factId: string | null = null,
): Segment {
  const existing = seg.items.find((i) =>
    i.source.kind === 'catalog' && i.source.tag.canonical === tag.canonical
  )
  if (existing) return setIncluded(seg, existing.id, true)
  return addItem(seg, {
    ...by,
    id: newId(),
    source: { kind: 'catalog', tag },
    field,
    text: tag.canonical,
    included: true,
    factId,
  })
}

// 选用自创标签：复制标签文本；同一分类已在用时只重新勾选
export function pickCustomTag(
  seg: Segment,
  field: string | null,
  tag: CustomTag,
  by: OriginInfo = userOrigin(),
): Segment {
  const existing = seg.items.find((i) =>
    i.source.kind === 'custom' && i.source.customId === tag.id
  )
  if (existing) return setIncluded(seg, existing.id, true)
  return addItem(seg, {
    ...by,
    id: newId(),
    source: { kind: 'custom', customId: tag.id },
    field,
    text: tag.text,
    included: true,
    factId: null,
  })
}

// 选词区再点一次已选的标签：只取消勾选（不输出），条目和改写过的文本保留，再点会重新勾选
export function unpickCatalogTag(seg: Segment, canonical: string): Segment {
  return {
    ...seg,
    items: seg.items.map((i) =>
      i.source.kind === 'catalog' && i.source.tag.canonical === canonical
        ? { ...i, included: false }
        : i
    ),
  }
}

export function unpickCustomTag(seg: Segment, customId: string): Segment {
  return {
    ...seg,
    items: seg.items.map((i) =>
      i.source.kind === 'custom' && i.source.customId === customId
        ? { ...i, included: false }
        : i
    ),
  }
}

// 自由文本条目：原样保留（可含逗号、权重）
export function addTextItem(
  seg: Segment,
  text: string,
  by: OriginInfo = userOrigin(),
): Segment {
  const t = text.trim()
  if (!t) return seg
  return addItem(seg, {
    ...by,
    id: newId(),
    source: { kind: 'text' },
    field: null,
    text: t,
    included: true,
    factId: null,
  })
}

function mapItem(
  seg: Segment,
  id: string,
  fn: (i: PromptItem) => PromptItem,
): Segment {
  return { ...seg, items: seg.items.map((i) => (i.id === id ? fn(i) : i)) }
}

export function setIncluded(
  seg: Segment,
  id: string,
  included: boolean,
): Segment {
  return mapItem(seg, id, (i) => ({ ...i, included }))
}

// 批量启用 / 停用；不在 ids 里的条目不变
export function setIncludedMany(
  seg: Segment,
  ids: Iterable<string>,
  included: boolean,
): Segment {
  const set = new Set(ids)
  return {
    ...seg,
    items: seg.items.map((i) => (set.has(i.id) ? { ...i, included } : i)),
  }
}

export function setItemText(seg: Segment, id: string, text: string): Segment {
  return mapItem(seg, id, (i) => ({ ...i, text }))
}

export function removeItem(seg: Segment, id: string): Segment {
  return { ...seg, items: seg.items.filter((i) => i.id !== id) }
}

export function removeItems(seg: Segment, ids: Iterable<string>): Segment {
  const set = new Set(ids)
  return { ...seg, items: seg.items.filter((i) => !set.has(i.id)) }
}

// 上移（delta = -1）/ 下移（delta = 1）
export function moveItem(seg: Segment, id: string, delta: number): Segment {
  const from = seg.items.findIndex((i) => i.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= seg.items.length) return seg
  const items = [...seg.items]
  const [it] = items.splice(from, 1)
  items.splice(to, 0, it)
  return { ...seg, items }
}

// 拖动排序：把 id 移到 overId 当前所在的位置（其余条目顺延）。任一找不到则不变
export function moveItemTo(seg: Segment, id: string, overId: string): Segment {
  const from = seg.items.findIndex((i) => i.id === id)
  const to = seg.items.findIndex((i) => i.id === overId)
  if (from < 0 || to < 0 || from === to) return seg
  const items = [...seg.items]
  const [it] = items.splice(from, 1)
  items.splice(to, 0, it)
  return { ...seg, items }
}

export function setFieldState(
  seg: Segment,
  field: string,
  state: FieldState | null,
): Segment {
  const fieldStates = { ...seg.fieldStates }
  if (state) fieldStates[field] = state
  else delete fieldStates[field]
  return { ...seg, fieldStates }
}
