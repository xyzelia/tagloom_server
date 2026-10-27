// NovelAI prompt 语法：按顶层逗号拆成一条条，取出权重写法里的标签本身。
// 权重写法：{x} / [x]（可多层）、(x:1.2)、1.2::x::（V4 数值权重，里面可以有逗号）。

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSE = new Set(Object.values(OPEN))

// 按顶层逗号（和换行）拆分：括号里、数值权重块里的逗号不拆。去掉空白和空条目
export function splitPrompt(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let weighted = false
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === ':' && text[i + 1] === ':') {
      weighted = !weighted
      i++
    } else if (OPEN[c]) depth++
    else if (CLOSE.has(c)) depth = Math.max(0, depth - 1)
    else if ((c === ',' || c === '\n') && depth === 0 && !weighted) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

// s 整个被一对括号包住（第一个括号的配对正好是最后一个字符）
function wrapped(s: string): boolean {
  const close = OPEN[s[0]]
  if (!close || s[s.length - 1] !== close) return false
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (OPEN[s[i]]) depth++
    else if (CLOSE.has(s[i])) depth--
    if (depth === 0 && i < s.length - 1) return false
  }
  return true
}

const WEIGHT_BLOCK = /^-?\d+(?:\.\d+)?::([\s\S]*?)(?:::)?$/
const PAREN_WEIGHT = /^([\s\S]*?):\s*-?\d+(?:\.\d+)?$/

// 一条里的标签本身（用来查词库）；含逗号或剩下括号等不是单个标签时返回 null
export function promptCore(piece: string): string | null {
  let s = piece.trim()
  for (;;) {
    const block = s.match(WEIGHT_BLOCK)
    if (block) {
      s = block[1].trim()
      continue
    }
    if (wrapped(s)) {
      const paren = s[0] === '('
      s = s.slice(1, -1).trim()
      if (paren) s = s.replace(PAREN_WEIGHT, '$1').trim()
      continue
    }
    break
  }
  if (!s || /[,(){}[\]]|::/.test(s)) return null
  return s
}
