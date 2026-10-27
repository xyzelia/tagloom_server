// 人物 / 场景共用的路径规则：身份就是目录下的相对路径（share/paths.ts），这里做 service 层的格式检查与错误。
// 真正落到磁盘前，infra 还会检查符号链接和 realpath。
import {
  entryNameError,
  isJsonPath,
  isSafeCharacterPath,
  nameOf,
} from '../share/mod.ts'
import { TagloomError } from './errors.ts'

export const invalid = (message: string) =>
  new TagloomError('invalid_request', message)

export const exists = (path: string) =>
  new TagloomError('already_exists', `${path} 已存在`, { path })

// noun：错误提示里的叫法（人物 / 场景）
export function pathRules(noun: string) {
  function checkFile(path: string) {
    if (!path || !isSafeCharacterPath(path) || !isJsonPath(path)) {
      throw invalid(`路径必须是${noun}目录内的 .json 文件`)
    }
  }

  function checkFolder(path: string) {
    if (!isSafeCharacterPath(path)) {
      throw invalid(`路径必须是${noun}目录内的文件夹`)
    }
  }

  // 新建 / 移动的目标：最后一段必须是合法名称（上级文件夹必须已存在，由 repo 检查）
  function checkNewName(path: string, file: boolean) {
    if (file) checkFile(path)
    else checkFolder(path)
    if (!path) throw invalid('不能对根目录这样操作')
    const name = nameOf(path)
    if (file && !name.endsWith('.json')) {
      throw invalid('文件名必须以 .json 结尾')
    }
    const error = entryNameError(file ? name.slice(0, -'.json'.length) : name)
    if (error) throw invalid(error)
  }

  return { checkFile, checkFolder, checkNewName }
}

// 同一进程内串行化写操作，保证「读版本 → 写」不被并发请求穿插
export function serializer() {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => {})
    return next
  }
}
