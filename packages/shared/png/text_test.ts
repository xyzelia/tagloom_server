import assert from 'node:assert/strict'
import { readPngText } from './text.ts'
import { pngWith, tEXt } from './testing.ts'

const enc = new TextEncoder()

Deno.test('readPngText reads tEXt / uncompressed iTXt as UTF-8 and rejects non-PNG', () => {
  const itxt = enc.encode('Title\0\0\0zh\0标题\0中文标题')
  const png = pngWith([
    tEXt('Description', '雨夜'),
    ['iTXt', itxt],
    tEXt('Description', 'x'),
  ])
  assert.deepEqual(readPngText(png), { Description: '雨夜', Title: '中文标题' })
  assert.equal(readPngText(enc.encode('GIF89a')), null)
  // 截断的文件不越界
  assert.deepEqual(readPngText(png.subarray(0, 30)), {})
})
