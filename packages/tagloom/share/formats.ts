// 文件格式标记：tagloom 写出的 JSON 都带 format + formatVersion，按 format 判定文件类型。
// 例外：标记之前保存的人物文件没有 format，读取时仍当作人物（下次保存时补上）。
export const CHARACTER_FORMAT = 'tagloom.character'
export const CHARACTER_FORMAT_VERSION = 2
export const SCENE_FORMAT = 'tagloom.scene'
export const SCENE_FORMAT_VERSION = 1
export const PROJECT_FORMAT = 'tagloom.project'
export const OUTPUT_FORMAT = 'tagloom.output'
// 人物存档与下游成品共用的版本号
export const ARCHIVE_VERSION = 2
export const SCENE_OUTPUT_FORMAT = 'tagloom.scene-output'
export const SCENE_OUTPUT_FORMAT_VERSION = 1

export type FileKind =
  | 'character'
  | 'scene'
  | 'project'
  | 'output'
  | 'scene-output'
  | 'unknown'

const KINDS: Record<string, [Exclude<FileKind, 'unknown'>, number]> = {
  [CHARACTER_FORMAT]: ['character', CHARACTER_FORMAT_VERSION],
  [SCENE_FORMAT]: ['scene', SCENE_FORMAT_VERSION],
  [PROJECT_FORMAT]: ['project', ARCHIVE_VERSION],
  [OUTPUT_FORMAT]: ['output', ARCHIVE_VERSION],
  [SCENE_OUTPUT_FORMAT]: ['scene-output', SCENE_OUTPUT_FORMAT_VERSION],
}

// 只看标记，不校验内容。没有 format 的对象按旧人物文件处理；版本不认识的一律 unknown
export function detectFormat(value: unknown): FileKind {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'unknown'
  }
  const { format, formatVersion } = value as Record<string, unknown>
  if (format === undefined) return 'character'
  const known = typeof format === 'string' ? KINDS[format] : undefined
  return known && formatVersion === known[1] ? known[0] : 'unknown'
}

// 去掉格式标记，剩下的交给内容 schema
export function withoutFormat<T extends object>(
  value: T,
): Omit<T, 'format' | 'formatVersion'> {
  const { format: _f, formatVersion: _v, ...rest } = value as T & {
    format?: unknown
    formatVersion?: unknown
  }
  return rest
}
