// 测试用：拼一个只有文字块的 PNG（读取时不校验 CRC，填 0）
const enc = new TextEncoder()

export function pngWith(chunks: [string, Uint8Array][]): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (const [type, data] of [...chunks, ['IEND', new Uint8Array()] as const]) {
    const n = data.length
    parts.push(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
    parts.push(...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0)
  }
  return new Uint8Array(parts)
}

export const tEXt = (k: string, v: string): [string, Uint8Array] => [
  'tEXt',
  enc.encode(`${k}\0${v}`),
]
