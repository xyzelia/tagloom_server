// 导入的完整流程（命令行和导入界面共用）：读来源信息 → 导入 → 报告。
// root：数据源根目录。给出时，git 仓库根目录必须在它里面才采用（否则数据源文件夹本身
// 不是 git 仓库时，会误用外层项目仓库的版本信息）。
import { DatabaseSync } from 'node:sqlite'
import { referencedCategoryPaths } from '../share/mod.ts'
import { type CsvImportReport, importCsvFiles } from './csv.ts'
import { SCHEMA_VERSION } from './schema.ts'
import { isInside } from './source-dir.ts'
import {
  type GitInfo,
  gitTopLevel,
  type ImportLogRow,
  NO_GIT,
  readGitInfo,
  readLicense,
} from './source-info.ts'
import { missingPaths, readTagsTree } from './tags-tree.ts'
import { exists, writeTagsTreeCatalog } from './write.ts'

export interface SourceInfo extends GitInfo {
  // 默认来源名：git 仓库（或目录）的文件夹名
  name: string
  license: string
}

const baseName = (path: string) =>
  path.replaceAll('\\', '/').replace(/\/+$/, '').split('/').pop()!

// 目录所在的 git 仓库（在 root 里面时）
async function repoOf(dir: string, root?: string): Promise<string | null> {
  const top = await gitTopLevel(dir)
  if (!top) return null
  return root && !isInside(root, top) ? null : top
}

export async function readSourceInfo(
  dir: string,
  root?: string,
): Promise<SourceInfo> {
  const top = await repoOf(dir, root)
  const git = top ? await readGitInfo(top) : NO_GIT
  return {
    ...git,
    name: baseName(top ?? (dir === '.' ? Deno.cwd() : dir)),
    license: await readLicense(top ?? dir),
  }
}

// 各文件所在的 git 仓库根目录（本机路径，只用来判断是不是同一个仓库），不是仓库时为 ''
export async function reposOf(
  dirs: string[],
  root?: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const d of new Set(dirs)) out.set(d, (await repoOf(d, root)) ?? '')
  return out
}

// 词库里的导入记录；词库不存在或不是 v4 时返回 null
export async function readImportLog(
  dbPath: string,
): Promise<ImportLogRow[] | null> {
  if (!(await exists(dbPath))) return null
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const v = (db.prepare('PRAGMA user_version').get() as {
      user_version: number
    }).user_version
    if (v !== SCHEMA_VERSION) return null
    return (db.prepare(
      `SELECT seq, path, kind, name, repository, revision, dirty, license, data_version,
         imported_at, sha256, bytes, rows FROM import_log ORDER BY seq, path`,
    ).all() as Record<string, unknown>[]).map((r) => ({
      seq: r.seq as number,
      path: r.path as string,
      kind: r.kind as ImportLogRow['kind'],
      name: r.name as string,
      repository: r.repository as string,
      revision: r.revision as string,
      dirty: r.dirty === 1,
      license: r.license as string,
      dataVersion: r.data_version as string,
      importedAt: r.imported_at as string,
      sha256: r.sha256 as string,
      bytes: r.bytes as number,
      rows: r.rows as number | null,
    }))
  } finally {
    db.close()
  }
}

export interface TreeImportReport {
  replaced: boolean
  // 被替换掉的旧词库里有几次 CSV 导入（重新生成后都没有了）
  droppedImports: number
  version: string
  categories: number
  tags: number
  restricted: number
  frequencyRows: number
  log: ImportLogRow[]
  warnings: string[]
}

// 从 tags-tree 仓库从头生成词库 out（已存在时替换）
export async function runTreeImport(
  repo: string,
  out: string,
  options: { root?: string; now?: Date } = {},
): Promise<TreeImportReport> {
  const top = await repoOf(repo, options.root)
  const { data, log } = await readTagsTree(repo, {
    git: top !== null,
    now: options.now,
  })
  const missing = missingPaths(data, referencedCategoryPaths())
  if (missing.length) {
    throw new Error(
      `代码用到的 ${missing.length} 个分类路径在 tags-tree 里找不到，已中止（需要先改 share/fields.ts 或 share/tag-targets.ts）：\n  ${
        missing.join('\n  ')
      }`,
    )
  }
  const old = await readImportLog(out).catch(() => null)
  const droppedImports = new Set(
    (old ?? []).filter((r) => r.kind === 'csv').map((r) => r.seq),
  ).size
  const { replaced } = await writeTagsTreeCatalog(out, data, log)
  return {
    replaced,
    droppedImports,
    version: data.version,
    categories: data.categories.length,
    tags: data.tags.length,
    restricted: data.tags.filter((t) => t.restricted).length,
    frequencyRows: data.frequencyRows,
    log,
    warnings: data.warnings,
  }
}

// 把来源目录 dir 里的 CSV（相对 dir 的路径）作为一次导入写进词库
export async function runCsvImport(
  db: string,
  dir: string,
  files: string[],
  options: {
    name?: string
    dataVersion?: string
    root?: string
    now?: Date
  } = {},
): Promise<CsvImportReport & { source: SourceInfo }> {
  const info = await readSourceInfo(dir, options.root)
  const source = { ...info, name: options.name?.trim() || info.name }
  const report = await importCsvFiles(
    db,
    files.map((f) => `${dir}/${f}`),
    { ...source, dataVersion: options.dataVersion?.trim() ?? '' },
    { paths: files, now: options.now },
  )
  return { ...report, source }
}
