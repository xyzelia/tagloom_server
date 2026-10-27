// 「一个文档一个 JSON 文件」的通用存储：人物（characters/）和场景（scenes/）共用，放在任意层的子文件夹里。
// 身份就是相对路径，文件里不写 path（旧人物文件里的 id 字段读的时候忽略，下次保存时去掉）。
// - 写入先写临时文件再改名，进程中途退出不会留下半个文件。
// - 新建用硬链接落位（目标已存在会失败），移动前先检查目标：都不会覆盖已有文件。
// - 列表按文件夹逐层读取；每个文件按（修改时间, 大小）缓存摘要，没变的文件不重读。
//   在资源管理器里改了、移动了文件，下次打开那个文件夹就能看到。
// 文档是什么（解析、摘要、写出格式）由 codec 决定；并发控制（版本号、串行化）在 core 的 service 里。
import { join } from 'node:path'
import {
  type Character,
  CHARACTER_FORMAT,
  CHARACTER_FORMAT_VERSION,
  isJsonPath,
  isSafeCharacterPath,
  isSameOrInside,
  joinPath,
  parentOf,
  type Scene,
  SCENE_FORMAT,
  SCENE_FORMAT_VERSION,
  stemOf,
} from '../share/mod.ts'
import {
  type CharacterRepo,
  type CharacterSummary,
  type FolderEntry,
  type SceneRepo,
  sceneSearchText,
  type SceneSummary,
  sceneSummaryOf,
  storedCharacter,
  storedScene,
  summaryOf,
  TagloomError,
} from '../core/mod.ts'
import { createPathGuard, lexists, retryTransient } from './safe-path.ts'

// 超过这个大小的 JSON 不当作文档（与文件浏览页的预览上限一致）
const MAX_DOC_BYTES = 8 * 1024 * 1024

interface Doc {
  path: string
}

interface DocSummary {
  path: string
  title: string
}

export interface DocCodec<D extends Doc, S extends DocSummary> {
  // 错误提示里的叫法：人物 / 场景
  noun: string
  // 不是这种文档时返回 null（外部 JSON、存档、坏内容）
  parse(value: unknown, path: string): D | null
  summarize(doc: D): S
  // 全文搜索用的文本（小写）；不需要全文搜索时省略
  searchText?(doc: D): string
  // 写进文件的对象（不含 path）
  serialize(doc: D): unknown
}

export interface DocListing<S> {
  folder: string
  folders: FolderEntry[]
  docs: S[]
  otherFiles: number
}

interface Cached<S> {
  mtime: number
  size: number
  // null：不是这种文档
  summary: S | null
  text: string
}

const byName = (a: string, b: string) =>
  a.localeCompare(b, 'zh-CN', { numeric: true })

const tmpOf = (full: string) => `${full}.${crypto.randomUUID()}.tmp`

export function createJsonDocRepo<D extends Doc, S extends DocSummary>(
  dir: string,
  codec: DocCodec<D, S>,
) {
  const guard = createPathGuard(dir, codec.noun)
  const cache = new Map<string, Cached<S>>()
  const toText = (doc: D) =>
    JSON.stringify(codec.serialize(doc), null, 2) + '\n'

  const forget = (folder: string) => {
    for (const key of cache.keys()) {
      if (isSameOrInside(parentOf(key), folder)) cache.delete(key)
    }
  }

  async function summarize(
    full: string,
    path: string,
    info: Deno.FileInfo,
  ): Promise<Cached<S> | null> {
    const mtime = info.mtime?.getTime() ?? 0
    const hit = cache.get(path)
    if (hit && hit.mtime === mtime && hit.size === info.size) return hit
    const entry: Cached<S> = { mtime, size: info.size, summary: null, text: '' }
    if (info.size <= MAX_DOC_BYTES) {
      try {
        const doc = codec.parse(JSON.parse(await Deno.readTextFile(full)), path)
        if (doc) {
          entry.summary = codec.summarize(doc)
          entry.text = codec.searchText?.(doc) ?? ''
        }
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) throw e
        // 坏 JSON 不影响列出其他文档，在文件浏览页里能看到原文。
        // 其他读取错误（如 Windows 上文件被短暂占用）这次先跳过、不记缓存，下次列出时重读
        if (!(e instanceof SyntaxError)) {
          console.error(`[tagloom] skip unreadable ${path}`, e)
          return null
        }
      }
    }
    cache.set(path, entry)
    return entry
  }

  async function listEntries(folder: string) {
    const full = await guard.existing(folder)
    if (!(await Deno.stat(full)).isDirectory) throw guard.missing()
    const folders: FolderEntry[] = []
    const docs: { summary: S; text: string }[] = []
    let otherFiles = 0
    const seen = new Set<string>()
    for await (const entry of Deno.readDir(full)) {
      // 点开头的文件和文件夹（包括写入中的临时文件）、符号链接一律忽略
      if (entry.name.startsWith('.') || entry.isSymlink) continue
      const path = joinPath(folder, entry.name)
      if (!isSafeCharacterPath(path)) continue
      if (entry.isDirectory) {
        folders.push({ name: entry.name, path })
        continue
      }
      if (!entry.isFile || !isJsonPath(entry.name)) continue
      seen.add(path)
      try {
        const file = join(full, entry.name)
        const cached = await summarize(file, path, await Deno.lstat(file))
        if (cached?.summary) {
          docs.push({ summary: cached.summary, text: cached.text })
        } else otherFiles++
      } catch (e) {
        // 列目录和读文件之间被移走或删除
        if (e instanceof Deno.errors.NotFound) continue
        throw e
      }
    }
    for (const key of cache.keys()) {
      if (parentOf(key) === folder && !seen.has(key)) cache.delete(key)
    }
    folders.sort((a, b) => byName(a.name, b.name))
    docs.sort((a, b) =>
      byName(a.summary.title, b.summary.title) ||
      byName(stemOf(a.summary.path), stemOf(b.summary.path))
    )
    return { folder, folders, docs, otherFiles }
  }

  return {
    async listFolder(folder: string): Promise<DocListing<S>> {
      const r = await listEntries(folder)
      return { ...r, docs: r.docs.map((d) => d.summary) }
    },

    // 递归列出所有文档，附带全文搜索文本
    async listAll(): Promise<{ summary: S; text: string }[]> {
      const out: { summary: S; text: string }[] = []
      const queue = ['']
      while (queue.length) {
        const folder = queue.shift()!
        try {
          const listing = await listEntries(folder)
          out.push(...listing.docs)
          queue.push(...listing.folders.map((f) => f.path))
        } catch (e) {
          // 扫描期间被移走的子文件夹
          if (e instanceof TagloomError && e.code === 'not_found' && folder) {
            continue
          }
          throw e
        }
      }
      return out
    },

    async get(path: string): Promise<D | undefined> {
      const full = await guard.existing(path, true)
      const info = await Deno.stat(full)
      if (!info.isFile) throw guard.missing()
      if (info.size > MAX_DOC_BYTES) {
        throw guard.invalid(`${path} 超过 8 MiB，不是${codec.noun}文件`)
      }
      let value: unknown
      try {
        value = JSON.parse(await Deno.readTextFile(full))
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return undefined
        if (!(e instanceof SyntaxError)) throw e
      }
      const doc = codec.parse(value, path)
      if (!doc) {
        throw guard.invalid(
          codec.noun === '人物'
            ? `${path} 不是人物文件，可以在人物文件浏览页查看或导入`
            : `${path} 不是${codec.noun}文件`,
        )
      }
      return doc
    },

    async put(doc: D): Promise<void> {
      // 文件必须还在：被外部移走或删除时报 not_found，不在原位置悄悄新建一份
      const full = await guard.existing(doc.path, true)
      const tmp = tmpOf(full)
      await Deno.writeTextFile(tmp, toText(doc))
      try {
        await retryTransient(() => Deno.rename(tmp, full))
      } catch (e) {
        await Deno.remove(tmp).catch(() => {})
        throw e
      }
    },

    async create(doc: D): Promise<boolean> {
      const full = await guard.target(doc.path, true)
      if (await lexists(full)) return false
      const tmp = tmpOf(full)
      await Deno.writeTextFile(tmp, toText(doc))
      try {
        // 硬链接：目标已存在时失败，不会覆盖
        await Deno.link(tmp, full)
        return true
      } catch (e) {
        if (e instanceof Deno.errors.AlreadyExists) return false
        // 不支持硬链接的文件系统：退回「检查后改名」
        if (await lexists(full)) return false
        await retryTransient(() => Deno.rename(tmp, full))
        return true
      } finally {
        await retryTransient(() => Deno.remove(tmp)).catch(() => {})
      }
    },

    async move(from: string, to: string): Promise<boolean> {
      const src = await guard.existing(from, true)
      const dst = await guard.target(to, true)
      const caseOnly = from.toLowerCase() === to.toLowerCase()
      // 只改大小写时目标「已存在」的就是它自己（Windows 不区分大小写）
      if (!caseOnly && await lexists(dst)) return false
      await retryTransient(() => Deno.rename(src, dst))
      cache.delete(from)
      return true
    },

    async remove(path: string): Promise<boolean> {
      const full = await guard.existing(path, true)
      try {
        await retryTransient(() => Deno.remove(full))
        cache.delete(path)
        return true
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return false
        throw e
      }
    },

    async createFolder(path: string): Promise<boolean> {
      const full = await guard.target(path, false)
      try {
        await Deno.mkdir(full)
        return true
      } catch (e) {
        if (e instanceof Deno.errors.AlreadyExists) return false
        throw e
      }
    },

    async moveFolder(from: string, to: string): Promise<boolean> {
      const src = await guard.existing(from)
      if (!(await Deno.stat(src)).isDirectory) throw guard.missing()
      const dst = await guard.target(to, false)
      const caseOnly = from.toLowerCase() === to.toLowerCase()
      if (!caseOnly && await lexists(dst)) return false
      await retryTransient(() => Deno.rename(src, dst))
      forget(from)
      return true
    },

    async removeFolder(path: string): Promise<'removed' | 'not_empty'> {
      const full = await guard.existing(path)
      if (!(await Deno.stat(full)).isDirectory) throw guard.missing()
      for await (const _ of Deno.readDir(full)) return 'not_empty'
      await retryTransient(() => Deno.remove(full))
      forget(path)
      return 'removed'
    },
  }
}

// 人物：格式标记写在最前面；路径不写进文件
export function createJsonCharacterRepo(dir: string): CharacterRepo {
  const repo = createJsonDocRepo<Character, CharacterSummary>(dir, {
    noun: '人物',
    parse: storedCharacter,
    summarize: summaryOf,
    serialize: ({ path: _path, ...rest }) => ({
      format: CHARACTER_FORMAT,
      formatVersion: CHARACTER_FORMAT_VERSION,
      ...rest,
    }),
  })
  return {
    ...repo,
    async listFolder(folder) {
      const { docs, ...rest } = await repo.listFolder(folder)
      return { ...rest, characters: docs }
    },
    async listAll() {
      return (await repo.listAll()).map((d) => d.summary)
    },
  }
}

// 场景：同样把格式标记写在最前面
export function createJsonSceneRepo(dir: string): SceneRepo {
  const repo = createJsonDocRepo<Scene, SceneSummary>(dir, {
    noun: '场景',
    parse: storedScene,
    summarize: sceneSummaryOf,
    searchText: sceneSearchText,
    serialize: ({ path: _path, ...rest }) => ({
      format: SCENE_FORMAT,
      formatVersion: SCENE_FORMAT_VERSION,
      ...rest,
    }),
  })
  return {
    ...repo,
    async listFolder(folder) {
      const { docs, ...rest } = await repo.listFolder(folder)
      return { ...rest, scenes: docs }
    },
  }
}
