// 人物文件浏览：直接读取 characters 目录里的子文件夹和所有 JSON（包括不是人物的外部文件），只读。
// 路径校验与符号链接防护见 safe-path.ts。
import { TagloomError } from '../core/mod.ts'
import { characterContentSchema } from '../core/schema.ts'
import {
  detectFormat,
  displayTitle,
  isSafeCharacterPath,
  withoutFormat,
} from '../share/mod.ts'
import { createPathGuard } from './safe-path.ts'

const MAX_PREVIEW_BYTES = 8 * 1024 * 1024

export interface CharacterFileEntry {
  name: string
  path: string
  kind: 'folder' | 'file'
  bytes: number | null
  modifiedAt: number | null
}

export function createCharacterFiles(dir: string) {
  const guard = createPathGuard(dir)
  const { missing, invalid } = guard
  const checkedPath = (path: string, file = false) => guard.existing(path, file)

  return {
    async list(folder: string) {
      const full = await checkedPath(folder)
      if (!(await Deno.stat(full)).isDirectory) throw missing()
      const entries: CharacterFileEntry[] = []
      for await (const entry of Deno.readDir(full)) {
        if (entry.name.startsWith('.') || entry.isSymlink) continue
        if (
          !entry.isDirectory && !(entry.isFile && /\.json$/i.test(entry.name))
        ) continue
        const path = folder ? `${folder}/${entry.name}` : entry.name
        if (!isSafeCharacterPath(path)) continue
        try {
          const safe = await checkedPath(path)
          const info = await Deno.stat(safe)
          entries.push({
            name: entry.name,
            path,
            kind: entry.isDirectory ? 'folder' : 'file',
            bytes: entry.isDirectory ? null : info.size,
            modifiedAt: info.mtime?.getTime() ?? null,
          })
        } catch (e) {
          // 磁盘上被同时移动/删除的单个文件不影响其他条目。
          if (e instanceof TagloomError && e.code === 'not_found') continue
          if (e instanceof Deno.errors.NotFound) continue
          throw e
        }
      }
      entries.sort((a, b) =>
        (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) ||
        a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
      )
      return { folder, entries }
    },

    async read(path: string) {
      const full = await checkedPath(path, true)
      let file: Deno.FsFile
      try {
        file = await Deno.open(full, { read: true })
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) throw missing()
        throw e
      }
      let text: string
      try {
        const info = await file.stat()
        if (!info.isFile) throw missing()
        if (info.size > MAX_PREVIEW_BYTES) {
          throw invalid('文件超过 8 MiB，无法预览或导入')
        }
        // 有界读取：即使文件读取期间增长，也不会无限占用内存。
        const bytes = new Uint8Array(MAX_PREVIEW_BYTES + 1)
        let length = 0
        while (length < bytes.length) {
          const n = await file.read(bytes.subarray(length))
          if (n === null) break
          length += n
        }
        if (length > MAX_PREVIEW_BYTES) {
          throw invalid('文件超过 8 MiB，无法预览或导入')
        }
        text = new TextDecoder().decode(bytes.subarray(0, length))
      } finally {
        file.close()
      }
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        return { path, text, kind: 'invalid' as const, content: null }
      }
      const kind = detectFormat(value)
      const project = kind === 'project'
      // 只有人物（带人物标记或没有标记）和人物存档能导入；成品、场景等其他格式不能当作人物原始数据。
      const inner = project
        ? (value as { character?: unknown }).character
        : kind === 'character'
        ? value
        : null
      const parsed = characterContentSchema.safeParse(
        inner && typeof inner === 'object' ? withoutFormat(inner) : inner,
      )
      return {
        path,
        text,
        kind: parsed.success
          ? project ? 'project' as const : 'character' as const
          : 'json' as const,
        content: parsed.success ? parsed.data : null,
      }
    },
  }
}

export type CharacterFiles = ReturnType<typeof createCharacterFiles>

export function characterFileSummary(
  content: NonNullable<Awaited<ReturnType<CharacterFiles['read']>>['content']>,
) {
  return {
    title: displayTitle(content),
    profile: content.profile,
    stylePrompt: content.stylePrompt,
    comboCount: content.combos.length,
  }
}
