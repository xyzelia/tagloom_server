// 条目列表的「选中」状态（只在界面上，不保存）。和「启用」（PromptItem.included，会保存、影响输出）是两回事：
// 选中只决定批量操作作用在哪些条目上。
// 之后的框选（viselect 一类的库）只需要把选中结果交给 replaceSelection，其余不变。

export interface Selection {
  ids: ReadonlySet<string>
  // Shift + 点击的起点：上一次点过的条目
  anchor: string | null
}

export const emptySelection: Selection = { ids: new Set(), anchor: null }

// 只保留列表里还在的条目（条目可能被别处删掉或取消选词）
export function visibleSelection(
  sel: Selection,
  orderedIds: readonly string[],
): Set<string> {
  return new Set(orderedIds.filter((id) => sel.ids.has(id)))
}

// 点击某条的选择框。
// 不按 Shift：只切换这一条。
// 按 Shift 且起点还在列表里：起点到这一条（含两端）整段设成「这一条切换后的状态」，和 Gmail 一样。
export function clickSelect(
  sel: Selection,
  orderedIds: readonly string[],
  id: string,
  shift: boolean,
): Selection {
  const ids = new Set(sel.ids)
  const on = !ids.has(id)
  const from = shift && sel.anchor !== null
    ? orderedIds.indexOf(sel.anchor)
    : -1
  const to = orderedIds.indexOf(id)
  if (from < 0 || to < 0) {
    if (on) ids.add(id)
    else ids.delete(id)
  } else {
    const [lo, hi] = from < to ? [from, to] : [to, from]
    for (const x of orderedIds.slice(lo, hi + 1)) {
      if (on) ids.add(x)
      else ids.delete(x)
    }
  }
  return { ids, anchor: id }
}

// 列表头的「全选」框：已全选则全不选，否则全选
export function toggleSelectAll(
  sel: Selection,
  orderedIds: readonly string[],
): Selection {
  const all = orderedIds.length > 0 &&
    orderedIds.every((id) => sel.ids.has(id))
  return all ? emptySelection : { ids: new Set(orderedIds), anchor: null }
}

export function replaceSelection(ids: Iterable<string>): Selection {
  return { ids: new Set(ids), anchor: null }
}
