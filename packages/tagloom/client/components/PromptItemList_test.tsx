import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { addTextItem, emptySegment, setIncluded } from '@app/tagloom/share'
import { PromptItemList } from './PromptItemList.tsx'

function render(texts: string[], off: number[] = []) {
  let seg = emptySegment()
  for (const t of texts) seg = addTextItem(seg, t)
  for (const i of off) seg = setIncluded(seg, seg.items[i].id, false)
  return renderToStaticMarkup(
    <PromptItemList
      label='场景内容'
      segment={seg}
      customTags={[]}
      onChange={() => {}}
      addBox={null}
    />,
  )
}

Deno.test('rows: select box, enable toggle with state, drag handle; no bulk bar until something is selected', () => {
  const html = render(['light rays', 'rain'], [1])
  assert.match(html, /aria-label="选中「light rays」"/)
  assert.match(html, /aria-pressed="true" aria-label="输出「light rays」"/)
  assert.match(html, /aria-pressed="false" aria-label="输出「rain」"/)
  assert.match(html, /prompt-item-row[^"]* prompt-item-off/)
  assert.match(html, /aria-label="拖动排序「rain」"/)
  assert.match(html, /data-item-id="/)
  assert.match(html, /2 条/)
  assert.doesNotMatch(html, /role="toolbar"/)
})

Deno.test('empty list: no select-all box, shows the hint', () => {
  const html = render([])
  assert.doesNotMatch(html, /的全部条目/)
  assert.match(html, /还没有条目/)
})

Deno.test('default compact layout: chips wrap, source in the hover title; no per-list layout switch', () => {
  const html = render(['light rays'])
  assert.match(html, /prompt-item-rows is-chips/)
  assert.match(
    html,
    /data-source="text" title="文本" class="prompt-item-row is-chip"/,
  )
  assert.doesNotMatch(html, />紧凑</)
  assert.doesNotMatch(html, /class="tag is-light">文本</)
})
