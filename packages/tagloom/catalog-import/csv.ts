// CSV 导入：把固定表头的 CSV（如 ame-la/danbooru-tags-data-zh）作为附加信息写进已有的 v4 词库。
// 规则见 doc/CATALOG_DB.md 第 5 节：只写 CSV 列（type / zh / count / notes / 别名），不改 tags-tree 列；
// 后导入的覆盖先导入的，CSV 里是空值时不覆盖；别名合并去重；新建的标签没有分类、不受限。
// parseCatalogCsv 是纯函数；importCsvFiles 在词库副本上写，成功后再替换原文件。
import { DatabaseSync } from 'node:sqlite'
import { parse as parseCsv } from 'csv-parse/sync'
import { normalizeTerm } from '../share/mod.ts'
import { SCHEMA_VERSION } from './schema.ts'
import { assertRelativePath } from './privacy.ts'
import { type ImportLogRow, insertImportLog, sha256 } from './source-info.ts'
import { removeIfExists } from './write.ts'

export const CSV_COLUMNS = [
  'tag',
  'category',
  'aliases',
  'zh',
  'count',
  'notes',
] as const

// Danbooru 标签类型：0 通用 / 1 画师 / 3 作品 / 4 角色 / 5 元标签
const TYPES = new Set([0, 1, 3, 4, 5])
// 提醒里最多列出的行号
const EXAMPLES = 5

export interface CsvTagRow {
  // 规范化后的标签名
  name: string
  // CSV 里的原始写法
  sourceKey: string
  type: number | null
  zh: string
  count: number | null
  notes: string
  aliases: string[]
}

export interface ParsedCsv {
  // 表头（去掉首尾空格）
  header: string[]
  rows: CsvTagRow[]
  // 数据行数（不含表头）
  dataRows: number
  warnings: string[]
}

export function parseCatalogCsv(text: string, file: string): ParsedCsv {
  // 每行列数可以不同；空行跳过
  const records = parseCsv(text, {
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][]
  const header = (records[0] ?? []).map((h) => h.trim())
  const index = new Map(header.map((h, i) => [h, i]))
  if (!index.has('tag')) throw new Error(`${file}：表头里没有 tag 列`)
  const warnings: string[] = []
  const unknown = header.filter((h) =>
    h && !(CSV_COLUMNS as readonly string[]).includes(h)
  )
  if (unknown.length) {
    warnings.push(`${file}：忽略不认识的列 ${unknown.join('、')}`)
  }

  const bad = new Map<string, number[]>()
  const note = (what: string, line: number) => {
    const list = bad.get(what) ?? []
    list.push(line)
    bad.set(what, list)
  }
  const cell = (r: string[], col: string) => {
    const i = index.get(col)
    return i === undefined ? '' : (r[i] ?? '').trim()
  }

  const rows: CsvTagRow[] = []
  const body = records.slice(1)
  body.forEach((r, i) => {
    const line = i + 2
    if (r.every((v) => !v.trim())) return
    const sourceKey = cell(r, 'tag')
    const name = normalizeTerm(sourceKey)
    if (!name) return note('tag 为空，已跳过', line)

    let type: number | null = null
    const rawType = cell(r, 'category')
    if (rawType) {
      const n = Number(rawType)
      if (Number.isInteger(n) && TYPES.has(n)) type = n
      else note('category 不是 0 / 1 / 3 / 4 / 5，已忽略', line)
    }
    let count: number | null = null
    const rawCount = cell(r, 'count')
    if (rawCount) {
      const n = Number(rawCount)
      if (Number.isInteger(n) && n >= 0) count = n
      else note('count 不是非负整数，已忽略', line)
    }
    rows.push({
      name,
      sourceKey,
      type,
      zh: cell(r, 'zh'),
      count,
      notes: cell(r, 'notes'),
      aliases: cell(r, 'aliases').split('|').map((a) => a.trim()).filter(
        Boolean,
      ),
    })
  })
  for (const [what, lines] of bad) {
    warnings.push(
      `${file}：${lines.length} 行 ${what}（第 ${
        lines.slice(0, EXAMPLES).join('、')
      }${lines.length > EXAMPLES ? ' …' : ''} 行）`,
    )
  }
  return { header, rows, dataRows: body.length, warnings }
}

export interface CsvSource {
  name: string
  repository: string
  revision: string
  dirty: boolean
  license: string
  dataVersion: string
}

export interface CsvImportReport {
  seq: number
  log: ImportLogRow[]
  created: number
  updated: number
  aliasesAdded: number
  tagCount: number
  aliasCount: number
  warnings: string[]
}

const baseName = (path: string) => path.replaceAll('\\', '/').split('/').pop()!

// 把 CSV 文件作为一次导入（同一个 seq）写进词库 dbPath；先写副本，成功后替换。
// 导入记录里的路径默认是文件名；paths 可给出相对来源目录的路径（与 files 一一对应）
export async function importCsvFiles(
  dbPath: string,
  files: string[],
  source: CsvSource,
  options: { now?: Date; paths?: string[] } = {},
): Promise<CsvImportReport> {
  if (!files.length) throw new Error('没有要导入的 CSV 文件')
  if (options.paths && options.paths.length !== files.length) {
    throw new Error('paths 与 files 数量不一致')
  }
  const names = options.paths ?? files.map(baseName)
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) {
    throw new Error(`同一次导入里文件名不能重复：${dup}（请改名或分两次导入）`)
  }

  const importedAt = (options.now ?? new Date()).toISOString()
  const parsed: {
    file: string
    csv: ParsedCsv
    log: Omit<ImportLogRow, 'seq'>
  }[] = []
  for (const [i, f] of files.entries()) {
    const bytes = await Deno.readFile(f)
    // TextDecoder 默认会去掉文件开头的 BOM
    const csv = parseCatalogCsv(new TextDecoder().decode(bytes), names[i])
    parsed.push({
      file: names[i],
      csv,
      log: {
        path: assertRelativePath(names[i]),
        kind: 'csv',
        ...source,
        importedAt,
        sha256: await sha256(bytes),
        bytes: bytes.byteLength,
        rows: csv.dataRows,
      },
    })
  }

  const tmp = `${dbPath}.tmp`
  await removeIfExists(tmp)
  await removeIfExists(`${tmp}-journal`)
  try {
    await Deno.copyFile(dbPath, tmp)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error('词库不存在，请先用 tree 子命令从 tags-tree 生成')
    }
    throw e
  }

  const db = new DatabaseSync(tmp)
  let report: CsvImportReport
  try {
    const one = <T>(sql: string) => db.prepare(sql).get() as T
    const version = one<{ user_version: number }>('PRAGMA user_version')
      .user_version
    if (version !== SCHEMA_VERSION) {
      throw new Error(
        `词库格式不是 v${SCHEMA_VERSION}（user_version=${version}），请先用 tree 子命令重新生成`,
      )
    }
    const tree = one<{ n: number }>(
      `SELECT count(*) AS n FROM import_log WHERE seq = 1 AND kind = 'tags-tree'`,
    ).n
    if (!tree) {
      throw new Error('词库里没有 tags-tree 的导入记录，请先用 tree 子命令生成')
    }
    const seq = one<{ n: number }>('SELECT max(seq) AS n FROM import_log').n + 1

    db.exec('PRAGMA foreign_keys = ON')
    db.exec('BEGIN')
    const existing = new Set(
      (db.prepare('SELECT name FROM tag').all() as { name: string }[]).map((
        r,
      ) => r.name),
    )
    const aliasNorms = new Map<string, Set<string>>()
    for (
      const r of db.prepare('SELECT name, term FROM tag_alias').all() as {
        name: string
        term: string
      }[]
    ) {
      const set = aliasNorms.get(r.name) ?? new Set()
      set.add(normalizeTerm(r.term))
      aliasNorms.set(r.name, set)
    }

    const insertTag = db.prepare(
      `INSERT INTO tag (name, source_key, type, zh, count, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    // 空值不覆盖
    const updateTag = db.prepare(
      `UPDATE tag SET
         type  = coalesce(?1, type),
         zh    = CASE WHEN ?2 <> '' THEN ?2 ELSE zh END,
         count = coalesce(?3, count),
         notes = CASE WHEN ?4 <> '' THEN ?4 ELSE notes END
       WHERE name = ?5`,
    )
    const insertAlias = db.prepare(
      'INSERT OR IGNORE INTO tag_alias (name, term, source) VALUES (?, ?, ?)',
    )
    const insertSource = db.prepare(
      'INSERT OR IGNORE INTO tag_source (name, source, source_key) VALUES (?, ?, ?)',
    )

    const created = new Set<string>()
    const updated = new Set<string>()
    let aliasesAdded = 0
    for (const { csv } of parsed) {
      for (const r of csv.rows) {
        if (existing.has(r.name)) {
          updateTag.run(r.type, r.zh, r.count, r.notes, r.name)
          if (!created.has(r.name)) updated.add(r.name)
        } else {
          insertTag.run(r.name, r.sourceKey, r.type, r.zh, r.count, r.notes)
          existing.add(r.name)
          created.add(r.name)
        }
        insertSource.run(r.name, seq, r.sourceKey)
        const norms = aliasNorms.get(r.name) ?? new Set([r.name])
        norms.add(r.name)
        aliasNorms.set(r.name, norms)
        for (const a of r.aliases) {
          const norm = normalizeTerm(a)
          if (!norm || norms.has(norm)) continue
          norms.add(norm)
          insertAlias.run(r.name, a, seq)
          aliasesAdded++
        }
      }
    }

    const log = parsed.map((p): ImportLogRow => ({ seq, ...p.log }))
    insertImportLog(db, log)
    const tagCount = one<{ n: number }>('SELECT count(*) AS n FROM tag').n
    const aliasCount = one<{ n: number }>('SELECT count(*) AS n FROM tag_alias')
      .n
    const meta = db.prepare('UPDATE meta SET value = ? WHERE key = ?')
    meta.run(importedAt, 'generated_at')
    meta.run(String(tagCount), 'tag_count')
    meta.run(String(aliasCount), 'alias_count')
    db.exec('COMMIT')
    report = {
      seq,
      log,
      created: created.size,
      updated: updated.size,
      aliasesAdded,
      tagCount,
      aliasCount,
      warnings: parsed.flatMap((p) => p.csv.warnings),
    }
  } catch (e) {
    db.close()
    await removeIfExists(tmp)
    throw e
  }
  db.close()
  await Deno.rename(tmp, dbPath)
  return report
}
