import assert from 'node:assert/strict'
import { emptySegment } from './model.ts'
import {
  addTextItem,
  moveItemTo,
  pickCatalogTag,
  pickCustomTag,
  removeItems,
  setIncludedMany,
  setItemText,
  unpickCatalogTag,
  unpickCustomTag,
} from './segment.ts'
import { createCustomTag } from './custom-tags.ts'

const blue = {
  canonical: 'blue hair',
  labelZh: '蓝发',
  categoryPath: 'character.body.hair.color',
  catalogVersion: 'v1',
}

Deno.test('picking a catalog tag again after unpicking re-includes the same item, keeping edited text', () => {
  let seg = pickCatalogTag(emptySegment(), 'hair_color', blue)
  const id = seg.items[0].id
  seg = setItemText(seg, id, '(blue hair:1.2)')
  seg = unpickCatalogTag(seg, 'blue hair')
  assert.equal(seg.items.length, 1)
  assert.equal(seg.items[0].included, false)
  seg = pickCatalogTag(seg, 'hair_color', blue)
  assert.equal(seg.items.length, 1)
  assert.equal(seg.items[0].id, id)
  assert.equal(seg.items[0].included, true)
  assert.equal(seg.items[0].text, '(blue hair:1.2)')
})

Deno.test('unpicking only touches the matching tag', () => {
  const custom = createCustomTag(
    { text: 'star ahoge', label: '', fields: [] },
    {
      origin: 'user',
    },
  )
  let seg = pickCatalogTag(emptySegment(), 'hair_color', blue)
  seg = pickCustomTag(seg, 'hair_color', custom)
  seg = unpickCustomTag(seg, custom.id)
  assert.deepEqual(seg.items.map((i) => i.included), [true, false])
  seg = unpickCatalogTag(seg, 'red hair')
  assert.deepEqual(seg.items.map((i) => i.included), [true, false])
})

Deno.test('setIncludedMany / removeItems only touch the given ids, keeping order', () => {
  let seg = emptySegment()
  for (const t of ['a', 'b', 'c', 'd']) seg = addTextItem(seg, t)
  const [a, b, c, d] = seg.items.map((i) => i.id)
  seg = setIncludedMany(seg, [b, d, 'missing'], false)
  assert.deepEqual(seg.items.map((i) => i.included), [true, false, true, false])
  seg = setIncludedMany(seg, new Set([d]), true)
  assert.deepEqual(seg.items.map((i) => i.included), [true, false, true, true])
  seg = removeItems(seg, [a, c, 'missing'])
  assert.deepEqual(seg.items.map((i) => i.id), [b, d])
  assert.deepEqual(seg.items.map((i) => i.text), ['b', 'd'])
})

Deno.test('moveItemTo places the item where the target was, either direction', () => {
  let seg = emptySegment()
  for (const t of ['a', 'b', 'c', 'd']) seg = addTextItem(seg, t)
  const id = (t: string) => seg.items.find((i) => i.text === t)!.id
  const texts = (s: typeof seg) => s.items.map((i) => i.text).join('')
  assert.equal(texts(moveItemTo(seg, id('a'), id('c'))), 'bcad')
  assert.equal(texts(moveItemTo(seg, id('d'), id('b'))), 'adbc')
  assert.equal(moveItemTo(seg, id('b'), id('b')), seg)
  assert.equal(moveItemTo(seg, id('b'), 'missing'), seg)
  assert.equal(moveItemTo(seg, 'missing', id('b')), seg)
})
