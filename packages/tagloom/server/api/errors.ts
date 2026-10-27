// 错误 → HTTP 响应，响应体统一为 { code, message, details? }（与 novelai 插件一致）
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { TagloomError, type TagloomErrorCode } from '../../core/mod.ts'

export type ApiErrorCode = TagloomErrorCode | 'internal_error'

export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
  details?: unknown
}

const STATUS: Record<TagloomErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  version_conflict: 409,
  pending_limit: 409,
  already_exists: 409,
  invalid_request: 422,
}

export function errorBody(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): ApiErrorBody {
  return details === undefined ? { code, message } : { code, message, details }
}

export function handleError(error: Error, c: Context): Response {
  if (error instanceof TagloomError) {
    const hasDetails = Object.keys(error.details).length > 0
    return c.json(
      errorBody(
        error.code,
        error.message,
        hasDetails ? error.details : undefined,
      ),
      STATUS[error.code],
    )
  }
  console.error('[tagloom] unhandled api error', error)
  return c.json(errorBody('internal_error', 'internal server error'), 500)
}
