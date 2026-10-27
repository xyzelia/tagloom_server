import assert from 'node:assert/strict'
import {
  clickSelect,
  emptySelection,
  replaceSelection,
  toggleSelectAll,
  visibleSelection,
} from './selection.ts'

const ids = ['a', 'b', 'c', 'd', 'e']
const sorted = (s: ReadonlySet<string>) => [...s].sort()

Deno.test('plain click toggles one item and moves the anchor', () => {
  let s = clickSelect(emptySelection, ids, 'b', false)
  assert.deepEqual(sorted(s.ids), ['b'])
  assert.equal(s.anchor, 'b')
  s = clickSelect(s, ids, 'd', false)
  assert.deepEqual(sorted(s.ids), ['b', 'd'])
  s = clickSelect(s, ids, 'b', false)
  assert.deepEqual(sorted(s.ids), ['d'])
  assert.equal(s.anchor, 'b')
})

Deno.test('shift click selects the range from the anchor, in either direction', () => {
  let s = clickSelect(emptySelection, ids, 'b', false)
  s = clickSelect(s, ids, 'd', true)
  assert.deepEqual(sorted(s.ids), ['b', 'c', 'd'])
  assert.equal(s.anchor, 'd')
  s = clickSelect(emptySelection, ids, 'e', false)
  s = clickSelect(s, ids, 'c', true)
  assert.deepEqual(sorted(s.ids), ['c', 'd', 'e'])
})

Deno.test('shift click on a selected item clears the range', () => {
  let s = replaceSelection(ids)
  s = clickSelect(s, ids, 'b', false) // b off, anchor b
  s = clickSelect(s, ids, 'd', true) // d is on → range turns off
  assert.deepEqual(sorted(s.ids), ['a', 'e'])
})

Deno.test('shift click without a usable anchor acts like a plain click', () => {
  let s = clickSelect(emptySelection, ids, 'c', true)
  assert.deepEqual(sorted(s.ids), ['c'])
  s = { ids: s.ids, anchor: 'gone' }
  s = clickSelect(s, ids, 'e', true)
  assert.deepEqual(sorted(s.ids), ['c', 'e'])
})

Deno.test('select all toggles between all and none', () => {
  let s = toggleSelectAll(clickSelect(emptySelection, ids, 'a', false), ids)
  assert.deepEqual(sorted(s.ids), ids)
  s = toggleSelectAll(s, ids)
  assert.equal(s.ids.size, 0)
  assert.equal(toggleSelectAll(emptySelection, []).ids.size, 0)
})

Deno.test('visibleSelection drops items no longer in the list', () => {
  const s = replaceSelection(['a', 'x', 'c'])
  assert.deepEqual(sorted(visibleSelection(s, ids)), ['a', 'c'])
})
