// 导入来源的信息：git 版本与地址、LICENSE、文件哈希，以及导入记录（import_log）的读写。
// tags-tree 和 CSV 导入共用。写进库的地址都经过 privacy.ts 处理，本机路径不进库。
import type { DatabaseSync } from 'node:sqlite'
import { sanitizeRepository } from './privacy.ts'

export interface ImportLogRow {
  seq: number
  path: string
  kind: 'tags-tree' | 'csv'
  name: string
  repository: string
  revision: string
  dirty: boolean
  license: string
  dataVersion: string
  importedAt: string
  sha256: string
  bytes: number
  rows: number | null
}

export interface GitInfo {
  repository: string
  revision: string
  dirty: boolean
}

export const NO_GIT: GitInfo = { repository: '', revision: '', dirty: false }

async function git(dir: string, args: string[]): Promise<string | null> {
  try {
    const out = await new Deno.Command('git', {
      args: ['-C', dir, ...args],
      stdout: 'piped',
      stderr: 'null',
    }).output()
    return out.success ? new TextDecoder().decode(out.stdout).trim() : null
  } catch {
    // 没装 git、没有权限、不是 git 仓库（zip 解压）：都当作没有 git 信息
    return null
  }
}

export async function readGitInfo(dir: string): Promise<GitInfo> {
  const revision = await git(dir, ['rev-parse', 'HEAD'])
  if (!revision) return NO_GIT
  const remote = await git(dir, ['remote', 'get-url', 'origin'])
  const status = await git(dir, ['status', '--porcelain'])
  return {
    repository: sanitizeRepository(remote ?? ''),
    revision,
    dirty: !!status,
  }
}

// 目录所在 git 仓库的根目录（只在本机使用，不写进库）；不是 git 仓库时返回 null
export function gitTopLevel(dir: string): Promise<string | null> {
  return git(dir, ['rev-parse', '--show-toplevel'])
}

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']
const LICENSE_NAMES: [RegExp, string][] = [
  [/\bMIT License\b/i, 'MIT'],
  [/GNU AFFERO GENERAL PUBLIC LICENSE/i, 'AGPL-3.0'],
  [/GNU GENERAL PUBLIC LICENSE/i, 'GPL-3.0'],
  [/Apache License/i, 'Apache-2.0'],
  [/Creative Commons Attribution 4\.0/i, 'CC-BY-4.0'],
]

// 目录下的 LICENSE：认得的写 SPDX 名，认不出写 UNKNOWN，没有文件写 UNSPECIFIED
export async function readLicense(dir: string): Promise<string> {
  for (const name of LICENSE_FILES) {
    let body: string
    try {
      body = await Deno.readTextFile(`${dir}/${name}`)
    } catch {
      continue
    }
    const head = body.slice(0, 2000)
    return LICENSE_NAMES.find(([re]) => re.test(head))?.[1] ?? 'UNKNOWN'
  }
  return 'UNSPECIFIED'
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function insertImportLog(db: DatabaseSync, rows: ImportLogRow[]) {
  const stmt = db.prepare(
    `INSERT INTO import_log (seq, path, kind, name, repository, revision, dirty, license,
       data_version, imported_at, sha256, bytes, rows)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const r of rows) {
    stmt.run(
      r.seq,
      r.path,
      r.kind,
      r.name,
      r.repository,
      r.revision,
      r.dirty ? 1 : 0,
      r.license,
      r.dataVersion,
      r.importedAt,
      r.sha256,
      r.bytes,
      r.rows,
    )
  }
}
