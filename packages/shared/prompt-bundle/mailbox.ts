// Prompt 包暂存区：发送方放进去，接收方进页面时检测、导入或忽略后记一笔。模块之间只认这个键和格式。
// 存储由调用方传入（浏览器里是 localStorage：跨标签页可见，另一个标签页可监听 storage 事件）。
// 每个接收方各自记录处理过没有（consumedBy），互不影响；接收方看不到自己发出的条目；过期的条目在下次写入时清掉。
import { parsePromptBundle, type PromptBundle } from './bundle.ts'

export const HANDOFF_STORAGE_KEY = 'app.handoff.prompt-bundle'
export const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000
export const HANDOFF_MAX_ENTRIES = 10

export interface HandoffStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface HandoffEntry {
  id: string
  createdAt: number
  expiresAt: number
  // 发送方：id 用于接收方跳过自己发出的条目，label 用于显示
  from: { id: string; label: string }
  // 已导入或忽略过的接收方
  consumedBy: string[]
  bundle: PromptBundle
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function parseEntry(v: unknown): HandoffEntry | null {
  if (!isObject(v)) return null
  const { id, createdAt, expiresAt, from, consumedBy } = v
  const bundle = parsePromptBundle(v.bundle)
  if (
    !bundle || typeof id !== 'string' || !isObject(from) ||
    typeof from.id !== 'string' || typeof from.label !== 'string' ||
    typeof createdAt !== 'number' || typeof expiresAt !== 'number' ||
    !Array.isArray(consumedBy) ||
    !consumedBy.every((c) => typeof c === 'string')
  ) return null
  return {
    id,
    createdAt,
    expiresAt,
    from: { id: from.id, label: from.label },
    consumedBy,
    bundle,
  }
}

// 读不了、格式不对的内容当作空；只返回没过期的条目（按写入顺序）
export function readHandoffs(
  storage: HandoffStorage,
  now: number,
): HandoffEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(storage.getItem(HANDOFF_STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw.map(parseEntry).filter((e): e is HandoffEntry =>
    e !== null && e.expiresAt > now
  )
}

function write(storage: HandoffStorage, entries: HandoffEntry[]) {
  storage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(entries))
}

// 放进暂存区；只保留最近 HANDOFF_MAX_ENTRIES 条。存储写不进去（满了、被禁用）时抛出
export function postHandoff(
  storage: HandoffStorage,
  input: { from: HandoffEntry['from']; bundle: PromptBundle },
  opts: { id: string; now: number; ttlMs?: number },
): HandoffEntry {
  const entry: HandoffEntry = {
    id: opts.id,
    createdAt: opts.now,
    expiresAt: opts.now + (opts.ttlMs ?? HANDOFF_TTL_MS),
    from: input.from,
    consumedBy: [],
    bundle: input.bundle,
  }
  const kept = readHandoffs(storage, opts.now)
  write(storage, [...kept, entry].slice(-HANDOFF_MAX_ENTRIES))
  return entry
}

// 这个接收方还没处理过、也不是自己发出的条目，最新的在前
export function pendingHandoffs(
  storage: HandoffStorage,
  consumer: string,
  now: number,
): HandoffEntry[] {
  return readHandoffs(storage, now)
    .filter((e) => e.from.id !== consumer && !e.consumedBy.includes(consumer))
    .reverse()
}

// 导入或忽略后调用，之后这个接收方不再提示这一条
export function markHandoffConsumed(
  storage: HandoffStorage,
  id: string,
  consumer: string,
  now: number,
): void {
  const entries = readHandoffs(storage, now)
  write(
    storage,
    entries.map((e) =>
      e.id === id && !e.consumedBy.includes(consumer)
        ? { ...e, consumedBy: [...e.consumedBy, consumer] }
        : e
    ),
  )
}
