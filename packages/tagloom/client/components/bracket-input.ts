// 文本框里的括号辅助，行为类似代码编辑器（用于写权重：(tag:1.2)、[tag]、{tag}）：
// - 选中文字后输入 ( [ {：用括号包住选中的文字，并继续选中括号里面的文字（可以再套一层）
// - 没有选中时输入 ( [ {：光标后是行尾 / 空白 / 逗号 / 右括号时自动补上右括号，光标停在中间
// - 光标后正好是要输入的右括号：直接跳过，不重复插入
// - 光标在一对空括号中间按退格：两个一起删掉
// 只处理半角括号。输入法组字中、带 Ctrl / ⌘ / Alt 的按键不处理。
import type { KeyboardEvent } from 'react'

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSERS = new Set(Object.values(PAIRS))
// 光标后是这些字符（或行尾）时才自动补右括号
const AUTO_CLOSE_BEFORE = /^$|^[\s,)\]}]/

export interface BracketEdit {
  // 用 insert 替换 [from, to)；insert 为 null 表示不改文字，只移动光标
  from: number
  to: number
  insert: string | null
  // 之后的选区
  selStart: number
  selEnd: number
}

export function bracketEdit(
  value: string,
  start: number,
  end: number,
  key: string,
): BracketEdit | null {
  const close = PAIRS[key]
  if (close) {
    if (start !== end) {
      const inner = value.slice(start, end)
      return {
        from: start,
        to: end,
        insert: key + inner + close,
        selStart: start + 1,
        selEnd: end + 1,
      }
    }
    if (!AUTO_CLOSE_BEFORE.test(value.slice(start))) return null
    return {
      from: start,
      to: start,
      insert: key + close,
      selStart: start + 1,
      selEnd: start + 1,
    }
  }
  if (start !== end) return null
  if (CLOSERS.has(key) && value[start] === key) {
    return {
      from: start,
      to: start,
      insert: null,
      selStart: start + 1,
      selEnd: start + 1,
    }
  }
  if (
    key === 'Backspace' && start > 0 &&
    PAIRS[value[start - 1]] !== undefined &&
    PAIRS[value[start - 1]] === value[start]
  ) {
    return {
      from: start - 1,
      to: start + 1,
      insert: '',
      selStart: start - 1,
      selEnd: start - 1,
    }
  }
  return null
}

// 挂在 <input> 的 onKeyDown 上。用 execCommand 插入，保留浏览器的撤销记录，并照常触发 onChange；
// 浏览器不支持时退回到 fallback（调用方直接更新文字）。
export function onBracketKeyDown(
  e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  fallback: (value: string) => void,
) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
  const el = e.currentTarget
  const start = el.selectionStart
  const end = el.selectionEnd
  if (start === null || end === null) return
  const edit = bracketEdit(el.value, start, end, e.key)
  if (!edit) return
  e.preventDefault()
  if (edit.insert !== null) {
    el.setSelectionRange(edit.from, edit.to)
    const ok = edit.insert === ''
      ? document.execCommand('delete')
      : document.execCommand('insertText', false, edit.insert)
    if (!ok) {
      fallback(
        el.value.slice(0, edit.from) + edit.insert + el.value.slice(edit.to),
      )
    }
  }
  el.setSelectionRange(edit.selStart, edit.selEnd)
}
