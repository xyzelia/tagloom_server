// 给 AI agent 用的命令行工具：封装 TagLoom 服务的 agent 接口，只提供下面几个命令（不能修改、删除任何内容）。
// 需要 TagLoom 服务在运行（deno task dev / start）；本脚本不启动服务、不读写文件，只向本机发 HTTP 请求。
//
// 用法（在项目根目录）：
//   deno task tagloom-agent list [文本]
//   deno task tagloom-agent context <人物路径>
//   deno task tagloom-agent lookup <名称>...
//   deno task tagloom-agent match <描述>... [--tiers exact,loose] [--limit <n>] [--offset <n>]
//   deno task tagloom-agent search <文本>... [--field <字段key>] [--limit <n>] [--offset <n>]
//   deno task tagloom-agent tags <canonical>...
//   deno task tagloom-agent categories [分类路径]... [--q <文本>] [--limit <n>] [--offset <n>]
//   deno task tagloom-agent field-tags <字段key> [--q <文本>] [--limit <n>]
// 词库查询命令（lookup / match / search / tags / categories）的每个参数是一条查询，含空格要加引号；
// 分页命令可加 --catalog-version <第一页返回的版本>。
//   deno task tagloom-agent add-tags <人物路径> < body.json      # 请求体从标准输入读取（UTF-8 JSON）
//
// 人物路径就是人物文件在 data/tagloom/characters/ 下的相对路径，例如「漫画A/艾莉丝.json」（list 的 path 字段）。
//
// 服务地址默认 http://localhost:5175，可用环境变量 TAGLOOM_URL 改（只允许本机地址）。
// 输出：成功时 stdout 为 JSON；失败时 stderr 为 JSON { code, message, details? }，退出码 1。
// 使用说明见同目录的 README.md，底层接口见 API.md。

const USAGE = `用法：
  list [文本]                            所有文件夹里的人物（可按名称或路径筛选）
  context <人物路径>                      人物精简信息（档案、标签库、分类地址 / 字段 / 当前输出）
  lookup <名称>...                       核对标签名是否在词库（canonical / 名称 / 别名）
  match <描述>... [--tiers exact,loose] [--limit <n>] [--offset <n>]
                                         自然语言粗筛：可能相关的标签和提到的分类
  search <文本>... [--field <字段>] [--limit <n>] [--offset <n>]   全库检索词库
  tags <canonical>...                    标签详情（分类层级、来源）
  categories [分类路径]... [--q <文本>] [--limit <n>] [--offset <n>]
                                         浏览分类：不带路径列出根分类
  field-tags <字段> [--q <文本>] [--limit <n>]   在字段对应的词库分类内列出 / 搜索
  （词库查询的每个参数是一条，含空格加引号；分页可加 --catalog-version <版本>）
  add-tags <人物路径> < body.json         创建自创标签（可同时加进分类），请求体从标准输入读取
人物路径即 list 返回的 path，例如 漫画A/艾莉丝.json`

type Json = unknown

class CliError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Json) {
    super(message)
  }
}

function baseUrl(): string {
  const raw = Deno.env.get('TAGLOOM_URL') || 'http://localhost:5175'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CliError('invalid_config', `TAGLOOM_URL 不是有效地址：${raw}`)
  }
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new CliError(
      'invalid_config',
      'TAGLOOM_URL 只允许本机地址（localhost / 127.0.0.1）',
    )
  }
  return `${url.origin}/api/tagloom`
}

async function call(path: string, init?: RequestInit): Promise<Json> {
  const url = `${baseUrl()}${path}`
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    throw new CliError(
      'service_unavailable',
      `连不上 TagLoom 服务（${
        new URL(url).origin
      }）。请确认服务已启动（deno task dev 或 deno task start）`,
      { error: e instanceof Error ? e.message : String(e) },
    )
  }
  const text = await res.text()
  let body: Json = text
  try {
    body = JSON.parse(text)
  } catch { /* 非 JSON 原样返回 */ }
  if (!res.ok) {
    const b = body as { code?: string; message?: string; details?: Json }
    throw new CliError(
      b?.code ?? `http_${res.status}`,
      b?.message ?? text,
      b?.details,
    )
  }
  return body
}

// 解析 --name value 形式的选项，其余为位置参数
function parseArgs(args: string[]) {
  const positional: string[] = []
  const options: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new CliError('invalid_args', `选项 ${a} 缺少值\n${USAGE}`)
      }
      options[a.slice(2)] = value
      i++
    } else positional.push(a)
  }
  return { positional, options }
}

function need(value: string | undefined, name: string): string {
  if (!value) throw new CliError('invalid_args', `缺少参数 ${name}\n${USAGE}`)
  return value
}

const enc = encodeURIComponent

function needList(values: string[], name: string): string[] {
  const list = values.map((v) => v.trim()).filter(Boolean)
  if (!list.length) need(undefined, name)
  return list
}

function int(value: string, name: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) {
    throw new CliError('invalid_args', `${name} 需要非负整数：${value}`)
  }
  return n
}

// 分页命令的请求级参数
const paging = (options: Record<string, string>) => ({
  ...(options.limit ? { limit: int(options.limit, '--limit') } : {}),
  ...(options['catalog-version']
    ? { catalogVersion: options['catalog-version'] }
    : {}),
})
const offsetOf = (options: Record<string, string>) =>
  options.offset ? { offset: int(options.offset, '--offset') } : {}

const post = (path: string, body: Json) =>
  call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })

async function readStdinJson(): Promise<Json> {
  if (Deno.stdin.isTerminal()) {
    throw new CliError(
      'invalid_args',
      'add-tags 需要从标准输入提供 JSON 请求体，例如：... add-tags <人物路径> < body.json',
    )
  }
  const text = await new Response(Deno.stdin.readable).text()
  try {
    return JSON.parse(text)
  } catch {
    throw new CliError('invalid_json', '标准输入不是有效的 JSON')
  }
}

async function run(argv: string[]): Promise<Json> {
  const [command, ...rest] = argv
  const { positional, options } = parseArgs(rest)
  switch (command) {
    case 'list': {
      const q = positional.join(' ').trim()
      return await call(`/agent/characters${q ? `?q=${enc(q)}` : ''}`)
    }
    case 'context':
      return await call(
        `/agent/character?path=${enc(need(positional[0], '<人物路径>'))}`,
      )
    case 'lookup':
      return await post('/agent/catalog/lookup', {
        tags: needList(positional, '<名称>'),
      })
    case 'tags':
      return await post('/agent/catalog/tags', {
        canonicals: needList(positional, '<canonical>'),
      })
    case 'match':
      return await post('/agent/catalog/match', {
        ...paging(options),
        queries: needList(positional, '<描述>').map((text) => ({
          text,
          ...(options.tiers ? { tiers: options.tiers.split(',') } : {}),
          ...offsetOf(options),
        })),
      })
    case 'search':
      return await post('/agent/catalog/search', {
        ...paging(options),
        queries: needList(positional, '<文本>').map((q) => ({
          q,
          ...(options.field ? { field: options.field } : {}),
          ...offsetOf(options),
        })),
      })
    case 'categories':
      return await post('/agent/catalog/categories', {
        ...paging(options),
        // 不带路径 = 根分类
        queries: (positional.length ? positional : ['']).map((path) => ({
          ...(path ? { path } : {}),
          ...(options.q ? { q: options.q } : {}),
          ...offsetOf(options),
        })),
      })
    case 'field-tags': {
      const field = need(positional[0], '<字段>')
      const q = options.q ? `&q=${enc(options.q)}` : ''
      const limit = options.limit ? `&limit=${enc(options.limit)}` : ''
      return await call(`/catalog/field-tags?field=${enc(field)}${q}${limit}`)
    }
    case 'add-tags': {
      const path = need(positional[0], '<人物路径>')
      const body = await readStdinJson()
      return await call(`/agent/character/custom-tags?path=${enc(path)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      })
    }
    case undefined:
    case 'help':
    case '--help':
      return { usage: USAGE }
    default:
      throw new CliError('invalid_args', `未知命令：${command}\n${USAGE}`)
  }
}

if (import.meta.main) {
  try {
    const out = await run(Deno.args)
    console.log(JSON.stringify(out, null, 2))
  } catch (e) {
    const err = e instanceof CliError
      ? {
        code: e.code,
        message: e.message,
        ...(e.details === undefined ? {} : { details: e.details }),
      }
      : {
        code: 'internal_error',
        message: e instanceof Error ? e.message : String(e),
      }
    console.error(JSON.stringify(err, null, 2))
    Deno.exit(1)
  }
}

export { run }
