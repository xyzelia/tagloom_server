// 词库导入（「词库」页用）：浏览数据源目录、检测格式、导入，导入成功后重新加载词库。
// 只能选数据源目录（默认 data/data_source）里的目录；返回给页面的路径都相对这个目录，
// 出错信息里的本机路径也换成相对写法。同一时间只允许一个导入。
import {
  type CsvFileInfo,
  type DetectResult,
  detectSource,
  IMPORTABLE,
} from '../catalog-import/detect.ts'
import type { CsvImportReport } from '../catalog-import/csv.ts'
import {
  readImportLog,
  readSourceInfo,
  reposOf,
  runCsvImport,
  runTreeImport,
  type SourceInfo,
  type TreeImportReport,
} from '../catalog-import/run.ts'
import {
  listSourceDirs,
  relativeTo,
  resolveSourceDir,
  SourcePathError,
  sourceRoot,
} from '../catalog-import/source-dir.ts'
import type { ImportLogRow } from '../catalog-import/source-info.ts'
import type { CatalogStatus } from '../share/mod.ts'
import { TagloomError } from '../core/mod.ts'

export interface ImportGroup {
  seq: number
  kind: ImportLogRow['kind']
  name: string
  repository: string
  revision: string
  dirty: boolean
  license: string
  dataVersion: string
  importedAt: string
  files: { path: string; sha256: string; bytes: number; rows: number | null }[]
}

export interface CatalogAdminStatus {
  catalog: CatalogStatus
  // 词库文件名（不含目录）；null = 文件不存在
  file: string | null
  // 词库里的导入记录（按 seq 分组）；词库不存在或格式不对时为 null
  imports: ImportGroup[] | null
  sourceDirExists: boolean
  busy: boolean
}

export interface DetectResponse extends Omit<DetectResult, 'csv'> {
  path: string
  // 选到 tags-tree 仓库的子目录时，建议改选的目录（相对数据源目录）
  treeRootPath: string | null
  // repo：文件所在 git 仓库（相对数据源目录，'.' 是数据源目录本身），不是仓库时为 ''
  csv: (CsvFileInfo & { repo: string })[]
  // 来源信息（所选目录所在的仓库）；name 是默认来源名
  source: SourceInfo
  // 现在的词库：有没有 tags-tree 的导入、有几次 CSV 导入
  current: { hasTree: boolean; csvImports: number }
}

export interface ImportRequest {
  path: string
  kind: 'tags-tree' | 'csv'
  files?: string[]
  name?: string
  dataVersion?: string
  // 重新生成 tags-tree 会清空已导入的 CSV：词库里有 CSV 导入时必须为 true
  dropCsv?: boolean
}

export interface ImportResponse {
  kind: ImportRequest['kind']
  tree?: TreeImportReport
  csv?: CsvImportReport & { source: SourceInfo }
  ms: number
  // 重新加载词库的结果：reason 为空表示成功
  reload: { reason: string; status: CatalogStatus }
}

export interface CatalogAdminDeps {
  catalogPath: string
  sourceDir: string
  status: () => CatalogStatus
  // 重新打开词库并替换正在用的；失败时保留原来的，返回原因
  reload: () => string
}

function groupLog(rows: ImportLogRow[]): ImportGroup[] {
  const groups = new Map<number, ImportGroup>()
  for (const r of rows) {
    let g = groups.get(r.seq)
    if (!g) {
      g = {
        seq: r.seq,
        kind: r.kind,
        name: r.name,
        repository: r.repository,
        revision: r.revision,
        dirty: r.dirty,
        license: r.license,
        dataVersion: r.dataVersion,
        importedAt: r.importedAt,
        files: [],
      }
      groups.set(r.seq, g)
    }
    g.files.push({
      path: r.path,
      sha256: r.sha256,
      bytes: r.bytes,
      rows: r.rows,
    })
  }
  return [...groups.values()]
}

export function createCatalogAdmin(deps: CatalogAdminDeps) {
  let busy = false
  const fileName = deps.catalogPath.split(/[\\/]/).pop()!

  // 出错信息里不带本机路径
  async function scrub(message: string): Promise<string> {
    let out = message
    const root = await sourceRoot(deps.sourceDir).catch(() => null)
    for (
      const [abs, label] of [
        [root, 'data_source'],
        [deps.catalogPath, fileName],
      ] as const
    ) {
      if (!abs) continue
      for (const v of new Set([abs, abs.replaceAll('/', '\\')])) {
        out = out.replaceAll(v, label)
      }
    }
    return out
  }

  async function fail(e: unknown): Promise<never> {
    if (e instanceof TagloomError) throw e
    const message = e instanceof Error ? e.message : String(e)
    throw new TagloomError('invalid_request', await scrub(message))
  }

  async function resolve(path: string) {
    try {
      return await resolveSourceDir(deps.sourceDir, path)
    } catch (e) {
      if (e instanceof SourcePathError) {
        throw new TagloomError('invalid_request', e.message)
      }
      return fail(e)
    }
  }

  async function currentLog() {
    return await readImportLog(deps.catalogPath).catch(() => null)
  }

  async function status(): Promise<CatalogAdminStatus> {
    const log = await currentLog()
    let exists = true
    try {
      await Deno.stat(deps.catalogPath)
    } catch {
      exists = false
    }
    return {
      catalog: deps.status(),
      file: exists ? fileName : null,
      imports: log ? groupLog(log) : null,
      sourceDirExists: (await sourceRoot(deps.sourceDir)) !== null,
      busy,
    }
  }

  async function dirs(path: string) {
    try {
      // 第一次打开词库页时数据源目录还不存在：建一个空的，告诉用户往哪里放
      if (!path && (await sourceRoot(deps.sourceDir)) === null) {
        await Deno.mkdir(deps.sourceDir, { recursive: true })
      }
      return await listSourceDirs(deps.sourceDir, path)
    } catch (e) {
      if (e instanceof SourcePathError) {
        throw new TagloomError('invalid_request', e.message)
      }
      return fail(e)
    }
  }

  async function detect(path: string): Promise<DetectResponse> {
    const { dir, rel } = await resolve(path)
    const root = (await sourceRoot(deps.sourceDir))!
    try {
      const found = await detectSource(dir)
      const repos = await reposOf(
        found.csv.map((f) => (f.folder ? `${dir}/${f.folder}` : dir)),
        root,
      )
      const csv = found.csv.map((f) => {
        const top = repos.get(f.folder ? `${dir}/${f.folder}` : dir) ?? ''
        return { ...f, repo: top ? relativeTo(root, top) || '.' : '' }
      })
      let treeRootPath: string | null = null
      if (found.treeRootHint) {
        const up = found.treeRootHint.split('/').length
        const parts = rel ? rel.split('/') : []
        if (parts.length >= up) {
          treeRootPath = parts.slice(0, parts.length - up).join('/')
        }
      }
      const log = await currentLog()
      return {
        ...found,
        path: rel,
        treeRootPath,
        csv,
        source: await readSourceInfo(dir, root),
        current: {
          hasTree: !!log?.some((r) => r.seq === 1 && r.kind === 'tags-tree'),
          csvImports: new Set(
            (log ?? []).filter((r) => r.kind === 'csv').map((r) => r.seq),
          ).size,
        },
      }
    } catch (e) {
      return fail(e)
    }
  }

  async function runImport(req: ImportRequest): Promise<ImportResponse> {
    if (busy) {
      throw new TagloomError('pending_limit', '正在导入，请等这次完成后再试')
    }
    busy = true
    try {
      const { dir } = await resolve(req.path)
      const root = (await sourceRoot(deps.sourceDir))!
      const started = performance.now()
      // 按同样的规则重新检测，不信任页面传来的结果
      const found = await detectSource(dir).catch(fail)
      const out: Omit<ImportResponse, 'ms' | 'reload'> = { kind: req.kind }
      if (req.kind === 'tags-tree') {
        if (!found.tagsTree?.complete) {
          throw new TagloomError(
            'invalid_request',
            '这个目录不是完整的 tags-tree 仓库',
          )
        }
        const log = await currentLog()
        if (log?.some((r) => r.kind === 'csv') && !req.dropCsv) {
          throw new TagloomError(
            'invalid_request',
            '重新生成会清空已导入的 CSV，请确认后再导入',
          )
        }
        out.tree = await runTreeImport(dir, deps.catalogPath, { root }).catch(
          fail,
        )
      } else {
        const files = [...new Set(req.files ?? [])]
        if (!files.length) {
          throw new TagloomError('invalid_request', '没有选要导入的 CSV 文件')
        }
        const byPath = new Map(found.csv.map((f) => [f.path, f]))
        const bad = files.filter((f) => {
          const info = byPath.get(f)
          return !info || !IMPORTABLE.has(info.status)
        })
        if (bad.length) {
          throw new TagloomError(
            'invalid_request',
            `这些文件不能导入（不存在或格式不对）：${bad.join('、')}`,
          )
        }
        out.csv = await runCsvImport(deps.catalogPath, dir, files.sort(), {
          name: req.name,
          dataVersion: req.dataVersion,
          root,
        }).catch(fail)
      }
      const ms = Math.round(performance.now() - started)
      const reason = deps.reload()
      return {
        ...out,
        ms,
        reload: { reason: await scrub(reason), status: deps.status() },
      }
    } finally {
      busy = false
    }
  }

  return { status, dirs, detect, import: runImport }
}

export type CatalogAdmin = ReturnType<typeof createCatalogAdmin>
