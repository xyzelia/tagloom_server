// 读 PNG 的文字块（tEXt / 未压缩的 iTXt）。按 UTF-8 解码：NovelAI 写的中文 prompt 是 UTF-8，不是规范里的 Latin-1。
// zTXt 和压缩的 iTXt 需要异步解压，目前跳过。
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// 不是 PNG 返回 null；同名键只取第一个
export function readPngText(bytes: Uint8Array): Record<string, string> | null {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const utf8 = new TextDecoder()
  const out: Record<string, string> = {}
  let i = 8
  while (i + 8 <= bytes.length) {
    const length = view.getUint32(i)
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8))
    const start = i + 8
    const end = start + length
    if (end > bytes.length) break
    const data = bytes.subarray(start, end)
    if (type === 'IEND') break
    if (type === 'tEXt' || type === 'iTXt') {
      const entry = type === 'tEXt'
        ? readText(data, utf8)
        : readIText(data, utf8)
      if (entry && !(entry[0] in out)) out[entry[0]] = entry[1]
    }
    // 长度 + 类型 + 数据 + CRC
    i = end + 4
  }
  return out
}

function readText(
  data: Uint8Array,
  utf8: TextDecoder,
): [string, string] | null {
  const sep = data.indexOf(0)
  if (sep <= 0) return null
  return [
    utf8.decode(data.subarray(0, sep)),
    utf8.decode(data.subarray(sep + 1)),
  ]
}

// keyword \0 压缩标志 压缩方法 语言 \0 翻译后的关键字 \0 文本
function readIText(
  data: Uint8Array,
  utf8: TextDecoder,
): [string, string] | null {
  const sep = data.indexOf(0)
  if (sep <= 0 || sep + 2 >= data.length) return null
  if (data[sep + 1] !== 0) return null
  const lang = data.indexOf(0, sep + 3)
  if (lang < 0) return null
  const translated = data.indexOf(0, lang + 1)
  if (translated < 0) return null
  return [
    utf8.decode(data.subarray(0, sep)),
    utf8.decode(data.subarray(translated + 1)),
  ]
}
