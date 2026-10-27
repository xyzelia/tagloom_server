// 插件文档：读取各插件 docsDir 下的 .md（可嵌套子目录），每次请求都直接读磁盘，改了文档刷新即可看到。
// 路径和项目里的文件路径一致：/api/doc/<插件>/sub/X.md 返回原文（text/markdown，方便 AI 直接读取），
// /api/doc/<插件>/ 或 /api/doc/<插件>/sub/ 返回该目录的子目录和 .md 文件。
// 跳过以点开头的文件和目录；读取前用 realpath 确认目标在文档目录内（防止通过符号链接逃逸）。
import { type Context, Hono } from 'hono'
import { isAbsolute, join, relative } from 'node:path'
import type { ServerPlugin } from '@app/plugin-sdk'

export interface DocListing {
  // 相对文档目录的目录路径，根目录为 ''，其余以 / 结尾，如 guide/
  path: string
  dirs: string[]
  files: { name: string; title: string }[]
}

// 目录路径（不含首尾 /）每段都合法：非空、不以点开头、没有反斜杠、盘符和控制字符
function safeSegments(path: string): boolean {
  // deno-lint-ignore no-control-regex
  if (/[\\\x00-\x1f\x7f]/.test(path) || /^[A-Za-z]:/.test(path)) return false
  return path.split('/').every((s) => s !== '' && !s.startsWith('.'))
}

export function isSafeDocPath(path: string): boolean {
  return path.endsWith('.md') && safeSegments(path)
}

export function isSafeDocDir(path: string): boolean {
  return path === '' || safeSegments(path)
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

// README.md 排最前，其余按名字自然排序
export function compareDocNames(a: string, b: string): number {
  if (a === b) return 0
  if (a === 'README.md') return -1
  if (b === 'README.md') return 1
  return collator.compare(a, b)
}

// 标题取第一个一级标题（去掉行内代码的反引号），没有就用文件名
export function docTitle(name: string, content: string): string {
  const heading = /^#[ \t]+(.+?)[ \t#]*$/m.exec(content)
  return heading?.[1].replace(/`([^`]*)`/g, '$1') ??
    name.replace(/\.md$/, '')
}

export function createDocStore(root: string) {
  async function inside(path: string): Promise<boolean> {
    try {
      const rel = relative(await Deno.realPath(root), await Deno.realPath(path))
      return !rel.startsWith('..') && !isAbsolute(rel)
    } catch {
      return false
    }
  }

  return {
    // dir 不含首尾 /；不合法、不在目录内或不存在时返回 null
    async list(dir: string): Promise<DocListing | null> {
      if (!isSafeDocDir(dir)) return null
      const full = join(root, dir)
      if (!(await inside(full))) return null
      let entries: Deno.DirEntry[]
      try {
        entries = await Array.fromAsync(Deno.readDir(full))
      } catch (error) {
        if (
          error instanceof Deno.errors.NotFound ||
          error instanceof Deno.errors.NotADirectory
        ) return null
        throw error
      }
      const visible = entries.filter((e) => !e.name.startsWith('.'))
      const files = visible
        .filter((e) => e.isFile && e.name.endsWith('.md'))
        .map((e) => e.name)
        .sort(compareDocNames)
      return {
        path: dir ? `${dir}/` : '',
        dirs: visible.filter((e) => e.isDirectory).map((e) => e.name)
          .sort(collator.compare),
        files: await Promise.all(files.map(async (name) => ({
          name,
          title: docTitle(name, await Deno.readTextFile(join(full, name))),
        }))),
      }
    },

    async read(path: string): Promise<string | null> {
      if (!isSafeDocPath(path)) return null
      const full = join(root, path)
      if (!(await inside(full))) return null
      try {
        return await Deno.readTextFile(full)
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null
        throw error
      }
    },
  }
}

export function createDocsApi(plugins: readonly ServerPlugin[]) {
  const stores = new Map(
    plugins.flatMap((p) =>
      p.docsDir ? [[p.name, createDocStore(p.docsDir)] as const] : []
    ),
  )
  // path 由 Hono 解码（中文名、空格）；以 .md 结尾返回原文，其余（含空、以 / 结尾）按目录列出
  const serve = async (c: Context, module: string, path: string) => {
    const store = stores.get(module)
    if (!store) return c.json({ error: 'unknown module' }, 404)
    c.header('Cache-Control', 'no-cache')
    if (path.endsWith('.md')) {
      const content = await store.read(path)
      if (content === null) return c.json({ error: 'not found' }, 404)
      return c.body(content, 200, {
        'Content-Type': 'text/markdown; charset=utf-8',
      })
    }
    const listing = await store.list(path.replace(/\/+$/, ''))
    if (!listing) return c.json({ error: 'not found' }, 404)
    return c.json(listing, 200)
  }
  return new Hono()
    .get('/', (c) => c.json({ modules: [...stores.keys()] }, 200))
    .get('/:module', (c) => serve(c, c.req.param('module'), ''))
    .get(
      '/:module/:path{.*}',
      (c) => serve(c, c.req.param('module'), c.req.param('path')),
    )
}
