import assert from 'node:assert/strict'
import {
  HANDOFF_MAX_ENTRIES,
  HANDOFF_STORAGE_KEY,
  type HandoffStorage,
  markHandoffConsumed,
  parsePromptBundle,
  pendingHandoffs,
  postHandoff,
  type PromptBundle,
  readHandoffs,
} from './mod.ts'

const bundle = (title = 't'): PromptBundle => ({
  format: 'prompt-bundle',
  formatVersion: 1,
  title,
  prompt: 'street',
  negativePrompt: 'lowres',
  characters: [
    { label: '甲', prompt: '1girl', negativePrompt: '', x: 0.3, y: 0.5 },
  ],
  params: { width: 832, seed: 0 },
})

const TAGLOOM = { id: 'tagloom', label: 'TagLoom' }
const X = { id: 'x', label: 'X' }

function memory(): HandoffStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

Deno.test('parsePromptBundle checks structure and drops bad params', () => {
  assert.deepEqual(parsePromptBundle(bundle()), bundle())
  assert.equal(parsePromptBundle({ ...bundle(), formatVersion: 2 }), null)
  assert.equal(parsePromptBundle({ ...bundle(), prompt: 1 }), null)
  assert.equal(parsePromptBundle([]), null)
  const loose = parsePromptBundle({
    ...bundle(),
    characters: [{ label: '', prompt: 'x', negativePrompt: '', x: 2, y: 0.5 }],
    params: { width: '832', seed: 5, model: ' m ', sampler: '' },
  })
  assert.deepEqual(loose?.characters[0], {
    label: '',
    prompt: 'x',
    negativePrompt: '',
    x: null,
    y: null,
  })
  assert.deepEqual(loose?.params, { seed: 5, model: 'm' })
})

Deno.test('mailbox: post, pending per consumer, consume, expire, cap', () => {
  const s = memory()
  postHandoff(s, { from: TAGLOOM, bundle: bundle('a') }, { id: '1', now: 0 })
  postHandoff(s, { from: TAGLOOM, bundle: bundle('b') }, {
    id: '2',
    now: 10,
    ttlMs: 100,
  })
  // 最新的在前
  assert.deepEqual(pendingHandoffs(s, 'novelai', 20).map((e) => e.id), [
    '2',
    '1',
  ])
  markHandoffConsumed(s, '2', 'novelai', 20)
  assert.deepEqual(pendingHandoffs(s, 'novelai', 20).map((e) => e.id), ['1'])
  // 别的接收方不受影响；发送方自己看不到
  assert.equal(pendingHandoffs(s, 'other', 20).length, 2)
  assert.equal(pendingHandoffs(s, 'tagloom', 20).length, 0)
  // 过期
  assert.deepEqual(readHandoffs(s, 200).map((e) => e.id), ['1'])

  for (let i = 0; i < HANDOFF_MAX_ENTRIES + 3; i++) {
    postHandoff(s, { from: X, bundle: bundle() }, { id: `n${i}`, now: 300 })
  }
  const all = readHandoffs(s, 300)
  assert.equal(all.length, HANDOFF_MAX_ENTRIES)
  assert.equal(all.at(-1)?.id, `n${HANDOFF_MAX_ENTRIES + 2}`)
})

Deno.test('mailbox: broken storage content reads as empty', () => {
  const s = memory()
  s.data.set(HANDOFF_STORAGE_KEY, '{not json')
  assert.deepEqual(readHandoffs(s, 0), [])
  s.data.set(HANDOFF_STORAGE_KEY, JSON.stringify([{ id: 1 }, 'x']))
  assert.deepEqual(readHandoffs(s, 0), [])
  postHandoff(s, { from: X, bundle: bundle() }, { id: 'ok', now: 0 })
  assert.deepEqual(readHandoffs(s, 0).map((e) => e.id), ['ok'])
})
