import assert from 'node:assert/strict'
import { buildTextMatchIndex, matchText, stem } from './text-match.ts'

// 小词库：id → canonical / 中文名 / 别名
const TAGS: [number, string, string[]][] = [
  [1, 'blue hair', ['蓝发']],
  [2, 'long hair', ['长发']],
  [3, 'serafuku', ['水手服']],
  [4, 'sailor', ['水手']],
  [5, 'holding umbrella', ['撑伞']],
  [6, 'umbrella', ['伞']],
  [7, 'transparent umbrella', ['透明伞']],
  [8, 'black eyes', ['黑眼']],
  [9, 'black-framed eyewear', ['黑框眼镜']],
  [10, 'smile', ['微笑']],
  [11, 'long sleeves', ['长袖']],
  [12, 'blush', ['脸红']],
]
const index = buildTextMatchIndex(
  TAGS.map(([id, canonical]) => ({ id, canonical, postCount: 100 - id })),
  TAGS.flatMap(([tagId, canonical, zh]) => [
    { tagId, term: canonical },
    ...zh.map((term) => ({ tagId, term })),
  ]),
  [
    { path: 'dynamics.expression', labels: ['expression', '表情'] },
  ],
)
const run = (text: string) => {
  const r = matchText(index, text)
  const tier = (canonical: string) => {
    const id = TAGS.find((t) => t[1] === canonical)![0]
    return r.candidates.find((c) => c.tagId === id)?.tier ?? null
  }
  return { ...r, tier }
}

Deno.test('chinese: exact, gapped and covering rules', () => {
  const r = run('蓝色长发的少女穿着水手服，撑着伞，表情害羞')
  assert.equal(r.tier('long hair'), 'exact')
  assert.equal(r.tier('serafuku'), 'exact')
  // 被包含的短词也保留
  assert.equal(r.tier('sailor'), 'exact')
  // 字不挨着：蓝色长发 → 蓝发，撑着伞 → 撑伞
  assert.equal(r.tier('blue hair'), 'loose')
  assert.equal(r.tier('holding umbrella'), 'loose')
  // 撑着伞 已被多字命中覆盖，单字「伞」不再单独算；但 related 会按命中词扩展
  assert.notEqual(r.tier('umbrella'), 'single')
  // 分类名只提示，不展开
  assert.deepEqual(r.categoryHints, [{
    path: 'dynamics.expression',
    text: '表情',
  }])
  // 分类名算命中，不出现在「没有命中」里
  assert.deepEqual(r.unmatched, ['的少女穿着', '害羞'])
})

Deno.test('chinese: gapped match inside another exact word is ignored', () => {
  const r = run('戴着黑框眼镜')
  assert.equal(r.tier('black-framed eyewear'), 'exact')
  assert.equal(r.tier('black eyes'), null)
})

Deno.test('chinese: single char only where no longer word matched', () => {
  assert.equal(run('一把伞').tier('umbrella'), 'single')
})

Deno.test('english: word sequences, any order, stems', () => {
  const r = run('long blue hair, holding an umbrella, smiling')
  assert.equal(r.tier('blue hair'), 'exact')
  // 实词齐全、顺序不同 / 中间隔了词
  assert.equal(r.tier('long hair'), 'loose')
  assert.equal(r.tier('umbrella'), 'exact')
  assert.equal(r.tier('holding umbrella'), 'loose')
  assert.equal(r.tier('smile'), 'exact')
  // umbrella 本身是命中的标签，可以扩展
  assert.equal(r.tier('transparent umbrella'), 'related')
  // long 只是形容词，单独出现不扩展
  assert.equal(r.tier('long sleeves'), null)
  // 不在词序列里的词不算（hair 不会匹配 chair）
  assert.equal(run('a chair').tier('blue hair'), null)
})

Deno.test('clauses keep loose matches apart', () => {
  // 蓝 和 发 在不同小句：不拼成 蓝发
  assert.equal(run('蓝，发').tier('blue hair'), null)
  assert.equal(run('blue sky, long hair').tier('blue hair'), null)
})

Deno.test('stem treats inflections the same', () => {
  assert.equal(stem('smiling'), stem('smile'))
  assert.equal(stem('sitting'), stem('sit'))
  assert.equal(stem('glasses'), stem('glass'))
  assert.equal(stem('ribbons'), stem('ribbon'))
})
