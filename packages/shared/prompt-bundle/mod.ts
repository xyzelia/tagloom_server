// 模块之间传递 Prompt 的中立格式与暂存区。纯函数，不依赖 Deno / DOM / Node（存储由调用方传入）。
export {
  parsePromptBundle,
  PROMPT_BUNDLE_FORMAT,
  PROMPT_BUNDLE_VERSION,
  type PromptBundle,
  type PromptBundleCharacter,
  type PromptBundleParams,
} from './bundle.ts'
export {
  HANDOFF_MAX_ENTRIES,
  HANDOFF_STORAGE_KEY,
  HANDOFF_TTL_MS,
  type HandoffEntry,
  type HandoffStorage,
  markHandoffConsumed,
  pendingHandoffs,
  postHandoff,
  readHandoffs,
} from './mailbox.ts'
