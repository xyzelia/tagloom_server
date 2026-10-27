import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  BASE_SEGMENTS,
  createCustomTag,
  emptySegment,
} from '@app/tagloom/share'
import { matchCustomTags, SegmentTagInput } from './SegmentTagInput.tsx'

const hair = BASE_SEGMENTS.find((d) => d.key === 'hair')!
const eyes = BASE_SEGMENTS.find((d) => d.key === 'eyes')!

Deno.test('custom tag suggestions match text or label and respect the segment fields', () => {
  const ahoge = createCustomTag({
    text: 'star-shaped ahoge',
    label: '星形呆毛',
    fields: ['hair_extra_structure'],
  }, { origin: 'user' })
  const any = createCustomTag({ text: 'glowing tattoo', label: '发光纹身' }, {
    origin: 'agent',
    agentName: 'a',
  })
  const tags = [ahoge, any]
  assert.deepEqual(matchCustomTags(tags, hair, '呆毛'), [ahoge])
  assert.deepEqual(matchCustomTags(tags, hair, 'STAR'), [ahoge])
  // 只适用于头发字段的标签不出现在眼睛分类；不限字段的都出现
  assert.deepEqual(matchCustomTags(tags, eyes, 'a'), [any])
  assert.deepEqual(matchCustomTags(tags, hair, '  '), [])
})

Deno.test('the add box renders a labelled combobox with an add button', () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <SegmentTagInput
        def={hair}
        segment={emptySegment()}
        customTags={[]}
        onChange={() => {}}
      />
    </QueryClientProvider>,
  )
  assert.match(html, /role="combobox"/)
  assert.match(html, /aria-label="给「头发」添加标签或文本条目"/)
  assert.match(html, /＋ 添加<\/button>/)
})
