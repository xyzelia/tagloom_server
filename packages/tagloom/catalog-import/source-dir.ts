// 导入界面只允许选数据源根目录（默认 data/data_source）下的目录，嵌套多深都可以。
// 界面传来的是相对根目录的路径（用 / 分隔）；这里解析成本机路径，并确认真实位置
// （软链接解析后）仍在根目录里。返回给界面的只有相对路径。

// 扫描时跳过的目录
export const SKIP_DIR = (name: string) =>
  name.startsWith('.') || name === 'node_modules'

export class SourcePathError extends Error {}

const sep = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '')

// 相对路径 → 规范的写法（'' 表示根目录本身）；绝对路径、盘符、. 和 .. 一律拒绝
export function normalizeSourcePath(rel: string): string {
  const p = rel.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  if (!p) return ''
  if (/^[a-zA-Z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new SourcePathError('只能选数据源目录里的相对路径')
  }
  const parts = p.split('/')
  if (parts.some((s) => !s || s === '.' || s === '..')) {
    throw new SourcePathError('路径里不能有空段、. 或 ..')
  }
  return parts.join('/')
}

// 根目录的真实位置；不存在时返回 null
export async function sourceRoot(root: string): Promise<string | null> {
  try {
    const real = sep(await Deno.realPath(root))
    return (await Deno.stat(real)).isDirectory ? real : null
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null
    throw e
  }
}

// 相对路径 → 本机目录（真实位置，在根目录里）
export async function resolveSourceDir(
  root: string,
  rel: string,
): Promise<{ dir: string; rel: string }> {
  const realRoot = await sourceRoot(root)
  if (!realRoot) throw new SourcePathError('数据源目录不存在')
  const norm = normalizeSourcePath(rel)
  let real: string
  try {
    real = sep(await Deno.realPath(norm ? `${realRoot}/${norm}` : realRoot))
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new SourcePathError(`目录不存在：${norm}`)
    }
    throw e
  }
  if (!isInside(realRoot, real)) {
    throw new SourcePathError(`目录在数据源目录外面：${norm}`)
  }
  if (!(await Deno.stat(real)).isDirectory) {
    throw new SourcePathError(`不是目录：${norm}`)
  }
  return { dir: real, rel: norm }
}

// child 是否就是 root 或在 root 里面（Windows 不区分大小写）
export function isInside(root: string, child: string): boolean {
  const win = Deno.build.os === 'windows'
  const a = win ? sep(root).toLowerCase() : sep(root)
  const b = win ? sep(child).toLowerCase() : sep(child)
  return b === a || b.startsWith(`${a}/`)
}

// 本机路径相对根目录的写法（不在根目录里时返回 null）
export function relativeTo(root: string, child: string): string | null {
  if (!isInside(root, child)) return null
  return sep(child).slice(sep(root).length).replace(/^\/+/, '')
}

export interface SourceDirEntry {
  name: string
  // 相对数据源根目录
  path: string
}

// 一个目录下的子目录（不进入软链接、跳过 .开头 和 node_modules），按名称排序
export async function listSourceDirs(
  root: string,
  rel: string,
): Promise<{ path: string; dirs: SourceDirEntry[] }> {
  const { dir, rel: norm } = await resolveSourceDir(root, rel)
  const dirs: SourceDirEntry[] = []
  for await (const e of Deno.readDir(dir)) {
    if (!e.isDirectory || e.isSymlink || SKIP_DIR(e.name)) continue
    dirs.push({ name: e.name, path: norm ? `${norm}/${e.name}` : e.name })
  }
  dirs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { path: norm, dirs }
}
