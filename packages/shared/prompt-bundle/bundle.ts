// Prompt 包：模块之间传递「一份多角色 Prompt + 可选生成参数」的中立格式。
// 发送方（如 tagloom 场景）按它输出，接收方（如 novelai 新建任务）按它读取，双方互不 import。
export const PROMPT_BUNDLE_FORMAT = 'prompt-bundle'
export const PROMPT_BUNDLE_VERSION = 1

// 每项可选；没有的由接收方决定
export interface PromptBundleParams {
  model?: string
  width?: number
  height?: number
  steps?: number
  scale?: number
  cfgRescale?: number
  sampler?: string
  noiseSchedule?: string
  seed?: number
}

export interface PromptBundleCharacter {
  label: string
  prompt: string
  negativePrompt: string
  // 0..1；null = 不指定位置
  x: number | null
  y: number | null
}

export interface PromptBundle {
  format: typeof PROMPT_BUNDLE_FORMAT
  formatVersion: typeof PROMPT_BUNDLE_VERSION
  title: string
  prompt: string
  negativePrompt: string
  // 有序
  characters: PromptBundleCharacter[]
  params: PromptBundleParams
}

const NUMBER_PARAMS = [
  'width',
  'height',
  'steps',
  'scale',
  'cfgRescale',
  'seed',
] as const
const TEXT_PARAMS = ['model', 'sampler', 'noiseSchedule'] as const

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isUnit = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

// 结构不对返回 null；参数里类型不对的项丢掉（不让整份失效）
export function parsePromptBundle(value: unknown): PromptBundle | null {
  if (!isObject(value)) return null
  if (
    value.format !== PROMPT_BUNDLE_FORMAT ||
    value.formatVersion !== PROMPT_BUNDLE_VERSION
  ) return null
  const { title, prompt, negativePrompt, characters, params } = value
  if (
    typeof title !== 'string' || typeof prompt !== 'string' ||
    typeof negativePrompt !== 'string' || !Array.isArray(characters)
  ) return null
  const chars: PromptBundleCharacter[] = []
  for (const c of characters) {
    if (
      !isObject(c) || typeof c.label !== 'string' ||
      typeof c.prompt !== 'string' || typeof c.negativePrompt !== 'string'
    ) return null
    const placed = isUnit(c.x) && isUnit(c.y)
    chars.push({
      label: c.label,
      prompt: c.prompt,
      negativePrompt: c.negativePrompt,
      x: placed ? c.x as number : null,
      y: placed ? c.y as number : null,
    })
  }
  const out: PromptBundleParams = {}
  if (isObject(params)) {
    for (const k of NUMBER_PARAMS) {
      const v = params[k]
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    }
    for (const k of TEXT_PARAMS) {
      const v = params[k]
      if (typeof v === 'string' && v.trim()) out[k] = v.trim()
    }
  }
  return {
    format: PROMPT_BUNDLE_FORMAT,
    formatVersion: PROMPT_BUNDLE_VERSION,
    title,
    prompt,
    negativePrompt,
    characters: chars,
    params: out,
  }
}
