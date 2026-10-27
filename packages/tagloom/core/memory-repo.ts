import {
  type Character,
  isSameOrInside,
  nameOf,
  parentOf,
} from '../share/mod.ts'
import { type CharacterRepo, summaryOf, TagloomError } from './characters.ts'

// 内存实现，测试用。路径比较区分大小写（不模拟 Windows）。
export function createMemoryCharacterRepo(): CharacterRepo {
  const files = new Map<string, Character>()
  const folders = new Set<string>([''])
  const missing = () => new TagloomError('not_found', 'not found')
  const needFolder = (path: string) => {
    if (!folders.has(path)) throw missing()
  }
  const taken = (path: string) => files.has(path) || folders.has(path)
  const children = (folder: string) => ({
    folders: [...folders].filter((f) => f && parentOf(f) === folder),
    files: [...files.values()].filter((c) => parentOf(c.path) === folder),
  })

  return {
    listFolder(folder) {
      needFolder(folder)
      const kids = children(folder)
      return Promise.resolve({
        folder,
        folders: kids.folders.sort().map((path) => ({
          name: nameOf(path),
          path,
        })),
        characters: kids.files.map(summaryOf),
        otherFiles: 0,
      })
    },
    listAll: () => Promise.resolve([...files.values()].map(summaryOf)),
    get: (path) => {
      const c = files.get(path)
      return Promise.resolve(c ? structuredClone(c) : undefined)
    },
    put: (c) => {
      if (!files.has(c.path)) throw missing()
      files.set(c.path, structuredClone(c))
      return Promise.resolve()
    },
    create: (c) => {
      needFolder(parentOf(c.path))
      if (taken(c.path)) return Promise.resolve(false)
      files.set(c.path, structuredClone(c))
      return Promise.resolve(true)
    },
    move: (from, to) => {
      const c = files.get(from)
      if (!c) throw missing()
      needFolder(parentOf(to))
      if (taken(to)) return Promise.resolve(false)
      files.delete(from)
      files.set(to, { ...c, path: to })
      return Promise.resolve(true)
    },
    remove: (path) => Promise.resolve(files.delete(path)),
    createFolder: (path) => {
      needFolder(parentOf(path))
      if (taken(path)) return Promise.resolve(false)
      folders.add(path)
      return Promise.resolve(true)
    },
    moveFolder: (from, to) => {
      needFolder(from)
      needFolder(parentOf(to))
      if (taken(to)) return Promise.resolve(false)
      const move = (p: string) => to + p.slice(from.length)
      for (const f of [...folders]) {
        if (isSameOrInside(f, from)) {
          folders.delete(f)
          folders.add(move(f))
        }
      }
      for (const [p, c] of [...files]) {
        if (isSameOrInside(p, from)) {
          files.delete(p)
          files.set(move(p), { ...c, path: move(p) })
        }
      }
      return Promise.resolve(true)
    },
    removeFolder: (path) => {
      needFolder(path)
      const kids = children(path)
      if (kids.folders.length || kids.files.length) {
        return Promise.resolve('not_empty' as const)
      }
      folders.delete(path)
      return Promise.resolve('removed' as const)
    },
  }
}
