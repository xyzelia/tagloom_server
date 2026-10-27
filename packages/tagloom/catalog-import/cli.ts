// 词库导入工具（设计见 doc/CATALOG_DB.md）。
//
// 用法（在项目根目录）：
//   deno task tagloom-catalog tree --repo <tags-tree 仓库目录> [--out <词库文件>]
//   deno task tagloom-catalog csv [选项] <CSV 文件>...
//   deno task tagloom-catalog csv [选项] --dir <文件夹> [--exclude a.csv,b.csv]
//
// tree：从 tags-tree 仓库从头生成词库（导入记录 seq 1）。输出已存在时直接替换。
// csv：把 CSV 作为附加信息导入已有词库（一次导入一个 seq，文件名不能重复）；来源信息默认从
//      CSV 所在的 git 仓库读取，可用选项改。
// 默认词库 data/tagloom/tag_catalog.sqlite（TagLoom 读取的位置）。写完要重启服务。
import { importCsvFiles } from './csv.ts'
import { sanitizeRepository } from './privacy.ts'
import { runTreeImport } from './run.ts'
import { gitTopLevel, NO_GIT, readGitInfo, readLicense } from './source-info.ts'

const DEFAULT_DB = 'data/tagloom/tag_catalog.sqlite'

const USAGE = `用法：
  tree --repo <tags-tree 仓库目录> [--out <词库文件>]
       从 tags-tree 仓库从头生成词库，默认 ${DEFAULT_DB}（已存在时替换）
  csv [选项] <CSV 文件>...
  csv [选项] --dir <文件夹> [--exclude a.csv,b.csv]
       把 CSV（表头 tag,category,aliases,zh,count,notes）作为附加信息导入已有词库
       选项：--db <词库文件>  --name <来源名>  --repository <网址>  --revision <版本>
             --license <许可>  --data-version <数据版本>
       来源信息默认从 CSV 所在的 git 仓库读取；来源名默认为仓库（或文件夹）名`

class UsageError extends Error {}

function parseArgs(args: string[]) {
  const [command, ...rest] = args
  const flags = new Map<string, string>()
  const positional: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]
    if (!key.startsWith('--')) {
      positional.push(key)
      continue
    }
    const value = rest[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${key} 缺少值`)
    }
    flags.set(key.slice(2), value)
    i++
  }
  return { command, flags, positional }
}

function checkFlags(flags: Map<string, string>, allowed: string[]) {
  for (const k of flags.keys()) {
    if (!allowed.includes(k)) throw new UsageError(`不认识的参数 --${k}`)
  }
}

const dirOf = (path: string) => {
  const parts = path.replaceAll('\\', '/').split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') || '/' : '.'
}
const baseName = (path: string) =>
  path.replaceAll('\\', '/').replace(/\/+$/, '').split('/').pop()!

async function tree(flags: Map<string, string>, positional: string[]) {
  checkFlags(flags, ['repo', 'out'])
  if (positional.length) throw new UsageError(`多余的参数：${positional[0]}`)
  const repo = flags.get('repo')
  if (!repo) throw new UsageError('缺少 --repo')
  const out = flags.get('out') ?? DEFAULT_DB

  const dir = dirOf(out)
  if (dir !== '.') await Deno.mkdir(dir, { recursive: true })
  const r = await runTreeImport(repo, out)

  const info = r.log[0]
  const lines = [
    `已生成 ${out}${r.replaced ? '（替换了原文件）' : ''}`,
    `tags-tree ${info.dataVersion || '（无版本）'} · ${
      info.revision ? info.revision.slice(0, 7) : '无 git 信息'
    }${info.dirty ? '（有未提交的修改）' : ''} · ${info.license}`,
    info.repository && `仓库 ${info.repository}`,
    `分类 ${r.categories} · 标签 ${r.tags} · 受限 ${r.restricted} · 频次 CSV ${r.frequencyRows} 行`,
    ...r.log.map((l) =>
      `  ${l.path}  ${l.sha256.slice(0, 12)}  ${l.bytes} 字节`
    ),
    ...(r.warnings.length
      ? ['提醒：', ...r.warnings.map((w) => `  ${w}`)]
      : []),
    r.droppedImports > 0 &&
    `注意：原词库里的 ${r.droppedImports} 次 CSV 导入已清空，需要的话请重新导入。`,
    r.replaced &&
    '服务正在运行的话，重启后才会读到新库（在「词库」页导入会自动重新加载）。',
  ].filter(Boolean)
  console.log(lines.join('\n'))
}

async function csvFiles(
  flags: Map<string, string>,
  positional: string[],
): Promise<string[]> {
  const dir = flags.get('dir')
  if (!dir) {
    if (flags.has('exclude')) {
      throw new UsageError('--exclude 要和 --dir 一起用')
    }
    if (!positional.length) throw new UsageError('缺少要导入的 CSV 文件')
    return positional
  }
  if (positional.length) {
    throw new UsageError('--dir 和 CSV 文件参数不能同时用')
  }
  const exclude = new Set(
    (flags.get('exclude') ?? '').split(',').map((s) => s.trim()).filter(
      Boolean,
    ),
  )
  const names: string[] = []
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.toLowerCase().endsWith('.csv')) names.push(e.name)
  }
  const unknown = [...exclude].filter((n) => !names.includes(n))
  if (unknown.length) {
    throw new UsageError(
      `--exclude 里的文件不在 ${dir} 里：${unknown.join('、')}`,
    )
  }
  const files = names.filter((n) => !exclude.has(n)).sort().map((n) =>
    `${dir.replace(/[\\/]+$/, '')}/${n}`
  )
  if (!files.length) throw new UsageError(`${dir} 里没有要导入的 CSV 文件`)
  return files
}

async function csv(flags: Map<string, string>, positional: string[]) {
  checkFlags(flags, [
    'db',
    'dir',
    'exclude',
    'name',
    'repository',
    'revision',
    'license',
    'data-version',
  ])
  const db = flags.get('db') ?? DEFAULT_DB
  const files = await csvFiles(flags, positional)

  // 来源信息：先从 CSV 所在的 git 仓库读，再用选项覆盖
  const folder = dirOf(files[0])
  const top = await gitTopLevel(folder)
  const git = top ? await readGitInfo(folder) : NO_GIT
  let repository = git.repository
  if (flags.has('repository')) {
    repository = sanitizeRepository(flags.get('repository')!)
    if (!repository) {
      throw new UsageError('--repository 只能是网址（本机路径不记录）')
    }
  }
  const license = flags.get('license') ?? await readLicense(top ?? folder)
  const name = flags.get('name') ??
    baseName(top ?? (folder === '.' ? Deno.cwd() : folder))
  const revision = flags.get('revision') ?? git.revision

  const r = await importCsvFiles(db, files, {
    name,
    repository,
    revision,
    // 手填的版本不对应本地工作区，不记未提交修改
    dirty: flags.has('revision') ? false : git.dirty,
    license,
    dataVersion: flags.get('data-version') ?? '',
  })

  const lines = [
    `已更新 ${db}（导入记录 seq ${r.seq}）`,
    `来源 ${name} · ${revision ? revision.slice(0, 7) : '无版本'}${
      !flags.has('revision') && git.dirty ? '（有未提交的修改）' : ''
    } · ${license || '无许可信息'}`,
    repository && `仓库 ${repository}`,
    ...r.log.map((l) =>
      `  ${l.path}  ${l.rows} 行  ${l.sha256.slice(0, 12)}  ${l.bytes} 字节`
    ),
    `新建标签 ${r.created} · 补充已有标签 ${r.updated} · 新增别名 ${r.aliasesAdded}`,
    `词库现有标签 ${r.tagCount} · 别名 ${r.aliasCount}`,
    ...(r.warnings.length
      ? ['提醒：', ...r.warnings.map((w) => `  ${w}`)]
      : []),
    '服务正在运行的话，重启后才会读到新库。',
  ].filter(Boolean)
  console.log(lines.join('\n'))
}

if (import.meta.main) {
  try {
    const { command, flags, positional } = parseArgs(Deno.args)
    if (!command || command === 'help' || command === '--help') {
      console.log(USAGE)
    } else if (command === 'tree') {
      await tree(flags, positional)
    } else if (command === 'csv') {
      await csv(flags, positional)
    } else {
      throw new UsageError(`不认识的命令：${command}`)
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    if (e instanceof UsageError) console.error(USAGE)
    Deno.exit(1)
  }
}
