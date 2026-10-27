// 插件内统一的业务错误；HTTP 层（server/api/errors.ts）按 code 映射状态码
export type TagloomErrorCode =
  | 'not_found'
  | 'version_conflict'
  | 'invalid_request'
  | 'pending_limit'
  | 'already_exists'

export class TagloomError extends Error {
  constructor(
    readonly code: TagloomErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'TagloomError'
  }
}
