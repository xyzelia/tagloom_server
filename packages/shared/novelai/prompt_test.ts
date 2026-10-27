import assert from 'node:assert/strict'
import { promptCore, splitPrompt } from './prompt.ts'

Deno.test('splitPrompt splits on top-level commas only', () => {
  assert.deepEqual(splitPrompt(' rain , city,,\n2girls '), [
    'rain',
    'city',
    '2girls',
  ])
  assert.deepEqual(
    splitPrompt('{rain, night}, (city:1.2), 1.2::neon, wet street::, sky'),
    ['{rain, night}', '(city:1.2)', '1.2::neon, wet street::', 'sky'],
  )
  assert.deepEqual(splitPrompt(''), [])
})

Deno.test('promptCore strips weights and returns null for multi-tag pieces', () => {
  assert.equal(promptCore('blue hair'), 'blue hair')
  assert.equal(promptCore('{{rain}}'), 'rain')
  assert.equal(promptCore('[[film grain]]'), 'film grain')
  assert.equal(promptCore('(very aesthetic:1.15)'), 'very aesthetic')
  assert.equal(promptCore('1.2::neon lights::'), 'neon lights')
  assert.equal(promptCore('-1::text::'), 'text')
  assert.equal(promptCore('1.5::{smile}'), 'smile')
  assert.equal(promptCore('artist:foo'), 'artist:foo')
  assert.equal(promptCore('{rain, night}'), null)
  assert.equal(promptCore('{a} {b}'), null)
  assert.equal(promptCore('{}'), null)
})
