import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { Section } from './Section.tsx'

Deno.test('collapsed populated sections expose a text status and themed class without mounting editors', () => {
  const html = renderToStaticMarkup(
    <Section title='画风串' hasContent defaultOpen={false}>
      <textarea aria-label='画风串' />
    </Section>,
  )
  assert.match(html, /tagloom-section has-content/)
  assert.match(html, /有内容/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-controls=/)
  assert.doesNotMatch(html, /<textarea/)
})

Deno.test('empty sections have a distinct class and text, and retain existing default-open behavior', () => {
  const html = renderToStaticMarkup(
    <Section title='角色档案' hasContent={false}>
      <textarea aria-label='角色档案' />
    </Section>,
  )
  assert.match(html, /tagloom-section is-empty/)
  assert.match(html, /未填写/)
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /<textarea/)
})
