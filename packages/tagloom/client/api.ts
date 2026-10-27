import { DetailedError, hc, parseResponse } from 'hono/client'
import type { ApiErrorBody, TagloomApi } from '../server/mod.ts'

export const API_BASE = '/api/tagloom'
export const api = hc<TagloomApi>(API_BASE)
export { parseResponse }

// 人物以 characters/ 下的相对路径区分（如「漫画A/艾莉丝.json」），路径放在查询参数里
const qs = (params: Record<string, string>) => new URLSearchParams(params)

// 站内地址（相对于 /tagloom）
export const editHref = (path: string) => `/edit?${qs({ path })}`
export const folderHref = (folder: string) =>
  folder ? `/?${qs({ folder })}` : '/'
// 场景以 scenes/ 下的相对路径区分
export const sceneEditHref = (path: string) => `/scenes/edit?${qs({ path })}`
export const sceneFolderHref = (folder: string) =>
  folder ? `/scenes?${qs({ folder })}` : '/scenes'

// 导出用普通链接下载（服务端设置 Content-Disposition），导出的是已保存的版本
export const exportProjectUrl = (path: string) =>
  `${API_BASE}/characters/item/export/project?${qs({ path })}`
export const exportOutputUrl = (path: string, format: 'json' | 'text') =>
  `${API_BASE}/characters/item/export/output?${qs({ path, format })}`
export const exportSceneUrl = (path: string, format: 'json' | 'text') =>
  `${API_BASE}/scenes/item/export/output?${qs({ path, format })}`

export interface ApiError {
  code: ApiErrorBody['code'] | 'network_error'
  message: string
  details?: unknown
}

export function apiErrorOf(error: unknown): ApiError {
  if (error instanceof DetailedError) {
    const data = (error.detail as { data?: unknown } | undefined)?.data
    if (data && typeof data === 'object' && 'code' in data) {
      const body = data as ApiErrorBody
      return { code: body.code, message: body.message, details: body.details }
    }
    return { code: 'internal_error', message: error.message }
  }
  return {
    code: 'network_error',
    message: error instanceof Error ? error.message : String(error),
  }
}

// noun：提示里对正在编辑的东西的叫法（人物 / 场景）
export function errorText(error: ApiError, noun = '人物'): string {
  switch (error.code) {
    case 'version_conflict':
      return `${noun}已在别处被修改，你看到的不是最新版本。`
    case 'not_found':
      return `${noun}、文件或文件夹不存在，或已被移动、删除。`
    case 'already_exists':
      return `目标位置已经有同名的文件或文件夹：${
        error.message.replace(/ 已存在$/, '')
      }`
    case 'invalid_request': {
      const issues =
        (error.details as { issues?: { path: string; message: string }[] })
          ?.issues
      return `内容不正确：${error.message}${
        issues?.length
          ? `（${
            issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('；')
          }）`
          : ''
      }`
    }
    case 'network_error':
      return `网络错误：${error.message}`
    default:
      return `服务器错误：${error.message}`
  }
}

export const keys = {
  // 文件夹列表和全局搜索都在 list 下面，增删改后一起失效
  list: ['tagloom', 'list'] as const,
  folder: (folder: string) => ['tagloom', 'list', 'folder', folder] as const,
  search: (q: string) => ['tagloom', 'list', 'search', q] as const,
  files: (folder: string) => ['tagloom', 'files', folder] as const,
  file: (path: string) => ['tagloom', 'file-preview', path] as const,
  character: (path: string) => ['tagloom', 'characters', path] as const,
  // 场景文件夹列表和搜索都在 sceneList 下面，增删改后一起失效
  sceneList: ['tagloom', 'scene-list'] as const,
  sceneFolder: (folder: string) =>
    ['tagloom', 'scene-list', 'folder', folder] as const,
  sceneSearch: (q: string) => ['tagloom', 'scene-list', 'search', q] as const,
  scene: (path: string) => ['tagloom', 'scenes', path] as const,
  status: ['tagloom', 'catalog', 'status'] as const,
  agentChanges: (path: string, since: number) =>
    ['tagloom', 'characters', path, 'agent-changes', since] as const,
  catalogSearch: (q: string, limit: number) =>
    ['tagloom', 'catalog', 'search', q, limit] as const,
  segmentSearch: (paths: string, q: string) =>
    ['tagloom', 'catalog', 'segment-search', paths, q] as const,
  fieldTags: (field: string, q: string) =>
    ['tagloom', 'catalog', 'field-tags', field, q] as const,
  tagDetail: (canonical: string) =>
    ['tagloom', 'catalog', 'tag', canonical] as const,
  category: (path: string, limit: number) =>
    ['tagloom', 'catalog', 'category', path, limit] as const,
}
