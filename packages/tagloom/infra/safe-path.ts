// characters/、scenes/ 目录的路径守卫：人物编辑、场景编辑和文件浏览共用。
// 所有路径段都不能是符号链接，realpath 必须仍在根目录内，防止路径穿越与链接逃逸。
import { isAbsolute, join, relative, resolve } from 'node:path'
import { TagloomError } from '../core/mod.ts'
import {
  isJsonPath,
  isSafeCharacterPath,
  nameOf,
  parentOf,
} from '../share/mod.ts'

// Windows 上刚写入的文件可能被杀毒 / 索引服务短暂占用，rename 覆盖或删除会报
// PermissionDenied / Busy（实测最长约 1.3 秒）；最多重试约 3 秒，其他错误直接抛出。
export async function retryTransient<T>(op: () => Promise<T>): Promise<T> {
  for (let attempt = 0;; attempt++) {
    try {
      return await op()
    } catch (err) {
      const transient = err instanceof Deno.errors.PermissionDenied ||
        err instanceof Deno.errors.Busy
      if (!transient || Deno.build.os !== 'windows' || attempt >= 8) throw err
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(20 * 2 ** attempt, 1000))
      )
    }
  }
}

// noun：错误提示里对这个目录内容的叫法（人物 / 场景）
export function createPathGuard(dir: string, noun = '人物') {
  const root = resolve(dir)
  const missing = () => new TagloomError('not_found', '文件或文件夹不存在')
  const invalid = (message: string) =>
    new TagloomError('invalid_request', message)
  let ready: Promise<void> | null = null
  const ensureRoot = () => (ready ??= Deno.mkdir(root, { recursive: true }))

  // 格式检查：file = true 时必须以 .json 结尾
  function check(path: string, file: boolean) {
    if (!isSafeCharacterPath(path) || (file && !isJsonPath(path))) {
      throw invalid(
        file
          ? `路径必须是${noun}目录内的 .json 文件`
          : `路径必须是${noun}目录内的文件夹`,
      )
    }
  }

  // 已存在的路径 → 绝对路径；不存在或经过符号链接都当作不存在
  async function existing(path: string, file = false): Promise<string> {
    check(path, file)
    await ensureRoot()
    const full = join(root, path)
    try {
      let current = root
      for (const part of path ? path.split('/') : []) {
        current = join(current, part)
        if ((await Deno.lstat(current)).isSymlink) throw missing()
      }
      const rel = relative(await Deno.realPath(root), await Deno.realPath(full))
      if (
        rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') ||
        isAbsolute(rel)
      ) {
        throw missing()
      }
      return full
    } catch (e) {
      if (
        e instanceof Deno.errors.NotFound ||
        e instanceof Deno.errors.NotADirectory
      ) throw missing()
      throw e
    }
  }

  // 将要新建的路径：上级文件夹必须已存在且安全；目标本身是否存在由调用方处理
  async function target(path: string, file: boolean): Promise<string> {
    check(path, file)
    if (!path) throw invalid('不能对根目录这样操作')
    const parent = await existing(parentOf(path))
    if (!(await Deno.stat(parent)).isDirectory) throw missing()
    return join(parent, nameOf(path))
  }

  return { root, ensureRoot, existing, target, missing, invalid }
}

export type PathGuard = ReturnType<typeof createPathGuard>

// 路径（文件或文件夹）是否存在，不跟随符号链接
export async function lexists(full: string): Promise<boolean> {
  try {
    await Deno.lstat(full)
    return true
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false
    throw e
  }
}
