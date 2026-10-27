import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  emptyBase,
  emptyCombo,
  emptyState,
  MAX_CHARACTER_STATES,
} from '@app/tagloom/share'
import { StateEditor, StateList } from './StateEditor.tsx'
import { clearOverrideOutput, setOverrideChoice } from './state-ui.ts'

function render(state = emptyState('s'), characterSeed?: number) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <StateEditor
        state={state}
        combo={emptyCombo()}
        base={emptyBase()}
        characterSeed={characterSeed}
        profile=''
        lib={{
          customTags: [],
          onCreateCustomTag: () => {
            throw new Error()
          },
        }}
        onChange={() => {}}
        reportInvalid={() => {}}
      />
    </QueryClientProvider>,
  )
}

Deno.test('no overrides: collapsed header says 沿用造型, content not mounted', () => {
  const html = render()
  assert.match(html, /外观与服饰调整/)
  assert.match(html, /沿用造型/)
  assert.doesNotMatch(html, /已配置/)
  assert.match(
    html,
    /aria-expanded="false"[^>]*>(?:(?!<button).)*外观与服饰调整/s,
  )
  assert.doesNotMatch(html, /保留并补充/)
})

Deno.test('collapsed header shows count and labels incl. empty replacement', () => {
  let s = clearOverrideOutput(emptyState('s'), 'costume.top')
  s = setOverrideChoice(s, 'base.hair', 'append')
  const html = render(s)
  assert.match(html, /已配置 2 项调整/)
  assert.match(html, /上装（不输出）/)
  assert.match(html, /发型（补充）/)
  assert.doesNotMatch(html, /复制造型内容到这里/)
})

Deno.test('section order: expression, action, adjustments last', () => {
  const html = render()
  const e = html.indexOf('神态与表情')
  const a = html.indexOf('动作与姿势')
  const j = html.indexOf('外观与服饰调整')
  assert.ok(e > 0 && e < a && a < j)
  assert.ok(html.indexOf('状态名称') < e)
  assert.equal((html.match(/tagloom-section-title/g) ?? []).length, 3)
  assert.doesNotMatch(html.slice(j), /神态与表情|动作与姿势/)
  // expression/action sections open
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 2)
})

Deno.test('seed: inherit shows character seed; specific shows error when empty', () => {
  assert.match(render(emptyState('s'), 0), /使用人物种子 0/)
  assert.match(render(emptyState('s')), /没有有效种子/)
  const withSeed = render({ ...emptyState('s'), seed: 0 })
  assert.match(withSeed, /value="0"/)
})

Deno.test('state list prevents creating unsaveable states beyond the schema limit', () => {
  const states = Array.from(
    { length: MAX_CHARACTER_STATES },
    (_, i) => emptyState(`状态 ${i}`),
  )
  const html = renderToStaticMarkup(
    <StateList
      states={states}
      selectedId={states[0].id}
      onSelect={() => {}}
      onAdd={() => {}}
      onDuplicate={() => {}}
      onRemove={() => {}}
    />,
  )
  assert.match(html, /disabled=""[^>]*>＋ 新状态/)
  assert.match(html, /disabled=""[^>]*>复制当前状态/)
  assert.match(html, /最多 200 个状态/)
})
