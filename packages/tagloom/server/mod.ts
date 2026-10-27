// server：插件的 HTTP 层与组装入口。宿主只调用 tagloomPlugin(config)。
import { fileURLToPath } from 'node:url'
import type { ServerPlugin } from '@app/plugin-sdk'
import { createApi } from './api/mod.ts'
import type { TagloomConfig } from './config.ts'

export type { TagloomConfig } from './config.ts'
export { closeTagloomRuntime, getTagloomRuntime } from './runtime.ts'
export type { ApiErrorBody, ApiErrorCode } from './api/mod.ts'

// 前端用 hc<TagloomApi>('/api/tagloom')
export type TagloomApi = ReturnType<typeof createApi>

export function tagloomPlugin(config: TagloomConfig) {
  return {
    name: 'tagloom',
    api: createApi(config),
    docsDir: fileURLToPath(new URL('../doc/', import.meta.url)),
  } satisfies ServerPlugin
}
