import assert from 'node:assert/strict'
import { pngWith, tEXt } from '../png/testing.ts'
import { parseNovelaiPng } from './image-meta.ts'

const comment = {
  prompt: 'old prompt field',
  uc: 'old uc',
  seed: 1,
  v4_prompt: {
    caption: {
      base_caption: '2girls, rain',
      char_captions: [
        { char_caption: 'red hair', centers: [{ x: 0.3, y: 0.5 }] },
        { char_caption: 'blue hair', centers: [] },
      ],
    },
    use_coords: true,
  },
  v4_negative_prompt: {
    caption: {
      base_caption: 'lowres',
      char_captions: [{ char_caption: 'bad hands' }],
    },
  },
  request_type: 'PromptGenerateRequest',
  signed_hash: 'x',
}
const nai = (c: object | null, extra: [string, Uint8Array][] = []) =>
  pngWith([
    tEXt('Software', 'NovelAI'),
    tEXt('Source', 'NovelAI Diffusion V4.5 4BDE2A90'),
    tEXt('Description', 'desc'),
    ...(c ? [tEXt('Comment', JSON.stringify(c))] : []),
    ...extra,
  ])

Deno.test('parseNovelaiPng prefers v4 captions and reads characters with centers', () => {
  const m = parseNovelaiPng(nai(comment))!
  assert.equal(m.source, 'NovelAI Diffusion V4.5 4BDE2A90')
  assert.equal(m.requestType, 'PromptGenerateRequest')
  assert.equal(m.prompt, '2girls, rain')
  assert.equal(m.negative, 'lowres')
  assert.equal(m.useCoords, true)
  assert.equal(m.img2img, null)
  assert.deepEqual(m.characters, [
    { prompt: 'red hair', negative: 'bad hands', center: { x: 0.3, y: 0.5 } },
    { prompt: 'blue hair', negative: '', center: null },
  ])
  assert.equal(m.comment?.seed, 1)
})

Deno.test('parseNovelaiPng falls back to old fields, flags img2img, handles Description only', () => {
  const { v4_prompt: _, v4_negative_prompt: __, ...old } = comment
  const m = parseNovelaiPng(
    nai({ ...old, request_type: 'Img2ImgRequest', strength: 0.7 }),
  )!
  assert.equal(m.prompt, 'old prompt field')
  assert.equal(m.negative, 'old uc')
  assert.equal(m.characters, null)
  assert.deepEqual(m.img2img, { strength: 0.7, noise: null })

  const bare = parseNovelaiPng(nai(null))!
  assert.equal(bare.prompt, 'desc')
  assert.equal(bare.comment, null)
  assert.equal(bare.negative, null)

  assert.equal(parseNovelaiPng(pngWith([tEXt('Software', 'GIMP')])), null)
  assert.equal(parseNovelaiPng(new TextEncoder().encode('nope')), null)
})
