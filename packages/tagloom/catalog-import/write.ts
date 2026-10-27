// 从头写一个 v4 词库：先写 <out>.tmp，全部成功后再改名替换 <out>。
// 服务运行时只读打开词库，替换后要重启服务才会读到新库。
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts'
import { type ImportLogRow, insertImportLog } from './source-info.ts'
import type { TagsTreeData } from './tags-tree.ts'

export async function removeIfExists(path: string) {
  try {
    await Deno.remove(path)
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path)
    return true
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false
    throw e
  }
}

// 返回输出文件原来是否已存在（已被替换）
export async function writeTagsTreeCatalog(
  out: string,
  data: TagsTreeData,
  log: ImportLogRow[],
): Promise<{ replaced: boolean }> {
  const tmp = `${out}.tmp`
  await removeIfExists(tmp)
  await removeIfExists(`${tmp}-journal`)
  const db = new DatabaseSync(tmp)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(SCHEMA_SQL)
    db.exec('BEGIN')

    const category = db.prepare(
      'INSERT INTO category (path, label_en, label_ja, label_zh) VALUES (?, ?, ?, ?)',
    )
    for (const c of data.categories) {
      category.run(c.path, c.labelEn, c.labelJa, c.labelZh)
    }

    const tag = db.prepare(
      `INSERT INTO tag (name, source_key, category_path, label_en, label_ja, label_zh, post_count, restricted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const source = db.prepare(
      'INSERT INTO tag_source (name, source, source_key) VALUES (?, 1, ?)',
    )
    for (const t of data.tags) {
      tag.run(
        t.name,
        t.sourceKey,
        t.categoryPath,
        t.labelEn,
        t.labelJa,
        t.labelZh,
        t.postCount,
        t.restricted ? 1 : 0,
      )
      source.run(t.name, t.sourceKey)
    }

    insertImportLog(db, log)

    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
    meta.run('schema_version', String(SCHEMA_VERSION))
    meta.run('generated_at', log[0]?.importedAt ?? new Date().toISOString())
    meta.run('tag_count', String(data.tags.length))
    meta.run('alias_count', '0')

    db.exec('COMMIT')
  } catch (e) {
    db.close()
    await removeIfExists(tmp)
    throw e
  }
  db.close()
  const replaced = await exists(out)
  await Deno.rename(tmp, out)
  return { replaced }
}
