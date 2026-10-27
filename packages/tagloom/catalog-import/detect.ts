// 检测一个来源目录是哪种格式（导入界面和接口共用；规则见 doc/CATALOG_DB.md 第 10 节）。
//   tags-tree：目录下固定位置的三个文件都在；只有一部分时说明缺什么；
//              选到了仓库里的 data/source 时提示选仓库根目录。
//   CSV：目录及子目录里的 .csv（跳过 .开头、node_modules，不进软链接），表头有 tag 列；
//        属于 tags-tree 的频次文件不算。每个文件完整解析一遍，给出行数和提醒。
// 两种都有时由用户选导入方式。返回的路径都相对所选目录，不含本机路径。
import { CSV_COLUMNS, parseCatalogCsv } from './csv.ts'
import { SKIP_DIR } from './source-dir.ts'
import { FREQUENCY_FILE, MULTILINGUAL_FILE, TREE_FILE } from './tags-tree.ts'

export const TREE_FILES = [TREE_FILE, MULTILINGUAL_FILE, FREQUENCY_FILE]
// 扫描上限：目录深度、看过的目录项数、单个 CSV 大小
const MAX_DEPTH = 8
const MAX_ENTRIES = 20000
const MAX_CSV_BYTES = 200 * 1024 * 1024
// 画师默认不导入（导入时再决定）
const DEFAULT_OFF = new Set(['artist.csv'])

// full：只含已知列且不止 tag；extra：另有不认识的列（导入时忽略）；tag-only：只有 tag 列；
// no-tag / encoding / invalid / too-large：不能导入
export type CsvFileStatus =
  | 'full'
  | 'extra'
  | 'tag-only'
  | 'no-tag'
  | 'encoding'
  | 'invalid'
  | 'too-large'

export const IMPORTABLE: ReadonlySet<CsvFileStatus> = new Set([
  'full',
  'extra',
  'tag-only',
])

export interface CsvFileInfo {
  // 相对所选目录，/ 分隔
  path: string
  bytes: number
  status: CsvFileStatus
  header: string[]
  unknownColumns: string[]
  // 数据行数（不含表头），不能导入时为 null
  rows: number | null
  warnings: string[]
  // 默认勾选：完全符合且不是画师
  selected: boolean
  // 文件所在目录（相对所选目录），用来找它属于哪个 git 仓库
  folder: string
}

export interface DetectResult {
  kinds: ('tags-tree' | 'csv')[]
  tagsTree: {
    // 三个文件都在
    complete: boolean
    files: { path: string; bytes: number }[]
    missing: string[]
  } | null
  // 选到了 tags-tree 仓库里的子目录：建议改选的目录（相对所选目录的上几级，如 '../..'）
  treeRootHint: string | null
  csv: CsvFileInfo[]
  scanned: { dirs: number; csvFiles: number; truncated: boolean }
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const s = await Deno.lstat(path)
    return s.isFile ? s.size : null
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null
    throw e
  }
}

const baseName = (p: string) => p.split('/').pop()!
const folderOf = (p: string) => p.split('/').slice(0, -1).join('/')

export function inspectCsv(
  path: string,
  bytes: Uint8Array,
): Omit<CsvFileInfo, 'selected' | 'folder'> {
  const base = { path, bytes: bytes.byteLength, unknownColumns: [] }
  if (bytes.byteLength > MAX_CSV_BYTES) {
    return {
      ...base,
      status: 'too-large',
      header: [],
      rows: null,
      warnings: [`文件超过 ${MAX_CSV_BYTES / 1024 / 1024} MB`],
    }
  }
  let text: string
  try {
    // 默认去掉开头的 BOM
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return {
      ...base,
      status: 'encoding',
      header: [],
      rows: null,
      warnings: ['不是 UTF-8 编码'],
    }
  }
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  try {
    const parsed = parseCatalogCsv(text, baseName(path))
    const unknown = parsed.header.filter((h) =>
      h && !(CSV_COLUMNS as readonly string[]).includes(h)
    )
    const known = parsed.header.filter((h) =>
      h !== 'tag' && (CSV_COLUMNS as readonly string[]).includes(h)
    )
    return {
      ...base,
      status: unknown.length ? 'extra' : known.length ? 'full' : 'tag-only',
      header: parsed.header,
      unknownColumns: unknown,
      rows: parsed.dataRows,
      warnings: parsed.warnings,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      ...base,
      status: /没有 tag 列/.test(message) ? 'no-tag' : 'invalid',
      header: firstLine.split(',').map((h) => h.trim()).slice(0, 20),
      rows: null,
      warnings: [message],
    }
  }
}

export async function detectSource(dir: string): Promise<DetectResult> {
  // ── tags-tree ──
  const sizes = await Promise.all(
    TREE_FILES.map((f) => fileSize(`${dir}/${f}`)),
  )
  const present = TREE_FILES.filter((_, i) => sizes[i] !== null)
  const tagsTree = present.length
    ? {
      complete: present.length === TREE_FILES.length,
      files: TREE_FILES.flatMap((path, i) =>
        sizes[i] === null ? [] : [{ path, bytes: sizes[i]! }]
      ),
      missing: TREE_FILES.filter((_, i) => sizes[i] === null),
    }
    : null
  // 所选目录里直接就是这几个文件（选到了仓库里的 data/source）
  let treeRootHint: string | null = null
  if (!tagsTree) {
    const here = await Promise.all(
      TREE_FILES.map((f) => fileSize(`${dir}/${baseName(f)}`)),
    )
    if (here.some((s) => s !== null)) {
      const depth = TREE_FILE.split('/').length - 1
      treeRootHint = Array(depth).fill('..').join('/')
    }
  }

  // ── CSV ──
  const csv: CsvFileInfo[] = []
  let dirs = 0
  let entries = 0
  let truncated = false
  // 扫描时遇到的 tags-tree 仓库里那三个文件（相对所选目录）：不算 CSV 来源
  const treeOwned = new Set<string>()
  if (tagsTree) TREE_FILES.forEach((f) => treeOwned.add(f))
  if (treeRootHint) TREE_FILES.forEach((f) => treeOwned.add(baseName(f)))
  const walk = async (rel: string, depth: number) => {
    dirs++
    const abs = rel ? `${dir}/${rel}` : dir
    if (rel && (await fileSize(`${abs}/${TREE_FILE}`)) !== null) {
      TREE_FILES.forEach((f) => treeOwned.add(`${rel}/${f}`))
    }
    const subdirs: string[] = []
    const files: string[] = []
    for await (const e of Deno.readDir(abs)) {
      if (++entries > MAX_ENTRIES) {
        truncated = true
        return
      }
      if (e.isSymlink) continue
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory) {
        if (!SKIP_DIR(e.name)) subdirs.push(path)
      } else if (e.isFile && e.name.toLowerCase().endsWith('.csv')) {
        files.push(path)
      }
    }
    for (const path of files.sort()) {
      // tags-tree 的频次文件不是附加信息
      if (treeOwned.has(path)) continue
      const info = inspectCsv(path, await Deno.readFile(`${dir}/${path}`))
      csv.push({
        ...info,
        selected: info.status === 'full' &&
          !DEFAULT_OFF.has(baseName(path).toLowerCase()),
        folder: folderOf(path),
      })
    }
    if (depth >= MAX_DEPTH) {
      if (subdirs.length) truncated = true
      return
    }
    for (const sub of subdirs.sort()) {
      if (truncated) return
      await walk(sub, depth + 1)
    }
  }
  await walk('', 0)

  const kinds: DetectResult['kinds'] = []
  if (tagsTree?.complete) kinds.push('tags-tree')
  if (csv.some((f) => IMPORTABLE.has(f.status))) kinds.push('csv')
  return {
    kinds,
    tagsTree,
    treeRootHint,
    csv,
    scanned: { dirs, csvFiles: csv.length, truncated },
  }
}
