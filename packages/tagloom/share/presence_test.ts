import assert from 'node:assert/strict'
import {
  addFact,
  addTextItem,
  emptyCombo,
  emptySegment,
  hasComboContent,
  hasSegmentContent,
  setIncluded,
} from './mod.ts'

Deno.test('section presence counts recorded text even when it is excluded from output', () => {
  assert.equal(hasSegmentContent(emptySegment()), false)
  assert.equal(hasSegmentContent(addTextItem(emptySegment(), ' \n ')), false)
  const filled = addTextItem(emptySegment(), 'blue hair')
  assert.equal(hasSegmentContent(filled), true)
  assert.equal(
    hasSegmentContent(setIncluded(filled, filled.items[0].id, false)),
    true,
  )
})

Deno.test('section presence includes facts and explicit field states but ignores whitespace placeholders', () => {
  const fact = addFact(emptySegment(), {
    field: 'hair_color',
    text: '蓝发',
    sourceQuote: '',
  })
  assert.equal(hasSegmentContent(fact), true)
  assert.equal(
    hasSegmentContent(
      addFact(emptySegment(), {
        field: 'hair_color',
        text: ' ',
        sourceQuote: '',
      }),
    ),
    false,
  )
  assert.equal(
    hasSegmentContent({ ...emptySegment(), fieldStates: { hair_color: 'na' } }),
    true,
  )
  assert.equal(
    hasSegmentContent({
      ...emptySegment(),
      fieldStates: { hair_color: 'open' },
    }),
    true,
  )
})

Deno.test('combo presence includes optional categories and disabled override records, not default names', () => {
  const combo = emptyCombo('日常')
  assert.equal(hasComboContent(combo), false)
  const key = Object.keys(combo.segments)[0] as keyof typeof combo.segments
  combo.segments[key] = addTextItem(emptySegment(), 'jacket')
  assert.equal(hasComboContent(combo), true)
  combo.segments[key] = emptySegment()
  combo.hairOverride.segment = addTextItem(emptySegment(), 'ponytail')
  assert.equal(combo.hairOverride.enabled, false)
  assert.equal(hasComboContent(combo), true)
})
