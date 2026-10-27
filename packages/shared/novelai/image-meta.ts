// NovelAI 生成的 PNG：tEXt 里 Software = NovelAI，Comment 是生成参数的 JSON，Description 是 prompt。
// 这里只读出与用途无关的结构；怎么填进表单 / 场景由各插件自己决定。
// 角色在 v4_prompt / v4_negative_prompt 的 char_captions 里。
import { readPngText } from '../png/text.ts'

type Json = Record<string, unknown>

export interface NovelaiCharacter {
  prompt: string
  negative: string
  // 图片里记录的中心点（0..1）；useCoords 为 false 时 NovelAI 也会写 0.5,0.5，不代表用户指定了位置
  center: { x: number; y: number } | null
}

export interface NovelaiImageMeta {
  software: string | null
  // 模型描述，如 “NovelAI Diffusion V4.5 4BDE2A90”
  source: string | null
  requestType: string | null
  prompt: string
  // 完整负面 prompt（含 UC 预设文本）；没有记录时 null
  negative: string | null
  // null = 没有 v4 角色信息（老图或只有 Description）
  characters: NovelaiCharacter[] | null
  useCoords: boolean
  // 图生图：元数据里没有底图，只有强度 / 噪声
  img2img: { strength: number | null; noise: number | null } | null
  // Comment 原文（生成参数）；只有 Description 时 null
  comment: Json | null
}

interface Caption {
  base_caption?: unknown
  char_captions?: {
    char_caption?: unknown
    centers?: { x?: unknown; y?: unknown }[]
  }[]
}

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => typeof v === 'string' ? v : null
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

function parseComment(text: string | undefined): Json | null {
  if (!text) return null
  try {
    const v = JSON.parse(text)
    return isObject(v) ? v : null
  } catch {
    return null
  }
}

const captionOf = (v: unknown): Caption | null =>
  isObject(v) && isObject(v.caption) ? v.caption as Caption : null

// 请求类型带 img2img，或有 strength（图生图强度）
function isImg2Img(comment: Json): boolean {
  return /img2img/i.test(str(comment.request_type) ?? '') ||
    num(comment.strength) !== null
}

// 不是 NovelAI 生成的 PNG（或不是 PNG）返回 null
export function parseNovelaiPng(bytes: Uint8Array): NovelaiImageMeta | null {
  const text = readPngText(bytes)
  if (!text) return null
  const comment = parseComment(text.Comment)
  const fromNai = text.Software === 'NovelAI' ||
    (comment !== null && 'v4_prompt' in comment && 'signed_hash' in comment)
  if (!fromNai) return null

  const base = {
    software: text.Software ?? null,
    source: text.Source ?? null,
  }
  if (!comment) {
    return {
      ...base,
      requestType: null,
      prompt: text.Description ?? '',
      negative: null,
      characters: null,
      useCoords: false,
      img2img: null,
      comment: null,
    }
  }

  const positive = captionOf(comment.v4_prompt)
  const negative = captionOf(comment.v4_negative_prompt)
  const charNegatives = negative?.char_captions ?? []
  const v4 = comment.v4_prompt as { use_coords?: unknown } | undefined
  return {
    ...base,
    requestType: str(comment.request_type),
    prompt: str(positive?.base_caption) ?? str(comment.prompt) ??
      text.Description ?? '',
    negative: str(negative?.base_caption) ?? str(comment.uc),
    characters: positive
      ? (positive.char_captions ?? []).map((c, i) => {
        const center = c.centers?.[0]
        const x = num(center?.x)
        const y = num(center?.y)
        return {
          prompt: str(c.char_caption) ?? '',
          negative: str(charNegatives[i]?.char_caption) ?? '',
          center: x !== null && y !== null ? { x, y } : null,
        }
      })
      : null,
    useCoords: v4?.use_coords === true,
    img2img: isImg2Img(comment)
      ? { strength: num(comment.strength), noise: num(comment.noise) }
      : null,
    comment,
  }
}
