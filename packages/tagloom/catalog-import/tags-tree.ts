// tags-tree 导入：读取 Jannchie/danbooru-tags-tree 仓库 data/source/ 下的 3 个文件，
// 解析成分类和标签，并准备导入记录（seq 1）。规则见 doc/CATALOG_DB.md 第 4 节。
// parseTagsTree 是纯函数（只处理文本）；readTagsTree 负责读文件、算哈希、取 git 信息。
import { parse as parseCsv } from 'csv-parse/sync'
import { parse as parseYaml } from 'yaml'
import { normalizeTerm } from '../share/mod.ts'
import { assertRelativePath } from './privacy.ts'
import {
  type ImportLogRow,
  NO_GIT,
  readGitInfo,
  readLicense,
  sha256,
} from './source-info.ts'

export type { ImportLogRow } from './source-info.ts'

export const TREE_FILE = 'data/source/danbooru_tag_tree_v3.yaml'
export const MULTILINGUAL_FILE =
  'data/source/danbooru_tag_tree_v3.multilingual.yaml'
export const FREQUENCY_FILE = 'data/source/tag_frequency_general.csv'

// 根分类为 explicit 的标签算受限
const RESTRICTED_ROOT = 'explicit'

export interface TreeCategory {
  path: string
  labelEn: string
  labelJa: string
  labelZh: string
}

export interface TreeTag {
  name: string
  sourceKey: string
  categoryPath: string
  labelEn: string
  labelJa: string
  labelZh: string
  postCount: number
  restricted: boolean
}

export interface TagsTreeData {
  // 分类树 _meta.version
  version: string
  categories: TreeCategory[]
  tags: TreeTag[]
  // 频次 CSV 的数据行数（不含表头）
  frequencyRows: number
  // 不中止生成的问题：缺名称、缺频次、重复标签等
  warnings: string[]
}

type Labels = { en?: unknown; ja?: unknown; 'zh-CN'?: unknown }

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// failsafe：所有值都当字符串读，避免 1 / true / null 这类标签被 YAML 改写成数字、布尔
function yaml(source: string, file: string): Record<string, unknown> {
  const value = parseYaml(source, { schema: 'failsafe' })
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} 的顶层不是映射`)
  }
  return value as Record<string, unknown>
}

export function parseTagsTree(input: {
  tree: string
  multilingual: string
  frequency: string
}): TagsTreeData {
  const warnings: string[] = []
  const tree = yaml(input.tree, TREE_FILE)
  const labels = yaml(input.multilingual, MULTILINGUAL_FILE)
  const labelOf = (key: string): Labels => {
    const v = labels[key]
    return v && typeof v === 'object' ? v as Labels : {}
  }

  // 频次：tag,count（原始写法）
  const frequency = new Map<string, number>()
  const rows = parseCsv(input.frequency, {
    columns: true,
    skip_empty_lines: true,
  }) as Record<
    string,
    string
  >[]
  for (const r of rows) {
    const n = Number(r.count)
    if (r.tag && Number.isInteger(n) && n >= 0) frequency.set(r.tag, n)
    else warnings.push(`频次 CSV 有无效行：${JSON.stringify(r)}`)
  }

  const categories = new Map<string, TreeCategory>()
  const tags = new Map<string, TreeTag>()
  const missingCategoryLabels: string[] = []
  const missingTagLabels: string[] = []
  let missingFrequency = 0

  const addCategory = (path: string) => {
    if (categories.has(path)) return
    const l = labelOf(`category.${path}`)
    if (!text(l.en) && !text(l.ja) && !text(l['zh-CN'])) {
      missingCategoryLabels.push(path)
    }
    categories.set(path, {
      path,
      // 没有名称时用路径最后一段，保证界面上有字可显示
      labelEn: text(l.en) || path.split('.').pop()!,
      labelJa: text(l.ja),
      labelZh: text(l['zh-CN']),
    })
  }

  const addTags = (list: unknown[], path: string) => {
    for (const item of list) {
      const sourceKey = text(item)
      const name = normalizeTerm(sourceKey)
      if (!name) {
        warnings.push(`分类 ${path} 里有空标签，已跳过`)
        continue
      }
      const old = tags.get(name)
      if (old) {
        warnings.push(
          `标签 ${name} 重复（${old.sourceKey} @ ${old.categoryPath}、${sourceKey} @ ${path}），保留第一个`,
        )
        continue
      }
      const l = labelOf(`tag.${sourceKey}`)
      if (!text(l.en) && !text(l.ja) && !text(l['zh-CN'])) {
        missingTagLabels.push(sourceKey)
      }
      const postCount = frequency.get(sourceKey)
      if (postCount === undefined) missingFrequency++
      tags.set(name, {
        name,
        sourceKey,
        categoryPath: path,
        labelEn: text(l.en),
        labelJa: text(l.ja),
        labelZh: text(l['zh-CN']),
        postCount: postCount ?? 0,
        restricted: path.split('.')[0] === RESTRICTED_ROOT,
      })
    }
  }

  // 映射 = 分类（_tags 是直接挂在这一层的标签）；列表 = 这一层的标签
  const walk = (value: unknown, path: string) => {
    addCategory(path)
    if (Array.isArray(value)) return addTags(value, path)
    if (!value || typeof value !== 'object') {
      if (text(value)) {
        throw new Error(`${TREE_FILE}：${path} 的值既不是分类也不是标签列表`)
      }
      warnings.push(`分类 ${path} 是空的`)
      return
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === '_tags') {
        if (!Array.isArray(child)) {
          throw new Error(`${TREE_FILE}：${path}._tags 不是列表`)
        }
        addTags(child, path)
        continue
      }
      if (!key || key.includes('.')) {
        throw new Error(
          `${TREE_FILE}：${path} 下的分类名「${key}」不能为空或含「.」`,
        )
      }
      walk(child, `${path}.${key}`)
    }
  }

  for (const [root, value] of Object.entries(tree)) {
    if (root === '_meta') continue
    if (root.includes('.')) {
      throw new Error(`${TREE_FILE}：根分类名「${root}」不能含「.」`)
    }
    walk(value, root)
  }

  if (missingCategoryLabels.length) {
    warnings.push(
      `${missingCategoryLabels.length} 个分类没有 multilingual 名称，英文名用路径最后一段：${
        missingCategoryLabels.slice(0, 10).join('、')
      }`,
    )
  }
  if (missingTagLabels.length) {
    warnings.push(
      `${missingTagLabels.length} 个标签没有 multilingual 名称，名称留空：${
        missingTagLabels.slice(0, 10).join('、')
      }`,
    )
  }
  if (missingFrequency) {
    warnings.push(`${missingFrequency} 个标签在频次 CSV 里没有，频次记为 0`)
  }

  const meta = tree._meta
  const version = meta && typeof meta === 'object'
    ? text((meta as Record<string, unknown>).version)
    : ''
  if (!version) warnings.push(`${TREE_FILE} 没有 _meta.version`)

  return {
    version,
    categories: [...categories.values()],
    tags: [...tags.values()],
    frequencyRows: rows.length,
    warnings,
  }
}

// 代码用到的分类路径必须都在词库里，返回缺少的路径
export function missingPaths(
  data: TagsTreeData,
  required: string[],
): string[] {
  const have = new Set(data.categories.map((c) => c.path))
  return required.filter((p) => !have.has(p))
}

export interface ReadTagsTreeOptions {
  // false 时不调用 git（测试用）
  git?: boolean
  now?: Date
}

// 读取仓库：解析数据，并生成 3 个文件的导入记录（seq 1）
export async function readTagsTree(
  repo: string,
  options: ReadTagsTreeOptions = {},
): Promise<{ data: TagsTreeData; log: ImportLogRow[] }> {
  const files = [TREE_FILE, MULTILINGUAL_FILE, FREQUENCY_FILE]
  const bytes: Uint8Array<ArrayBuffer>[] = []
  for (const f of files) {
    try {
      bytes.push(await Deno.readFile(`${repo}/${f}`))
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new Error(`tags-tree 仓库里缺少 ${f}`)
      }
      throw e
    }
  }
  // TextDecoder 默认会去掉文件开头的 BOM
  const decode = (b: Uint8Array) => new TextDecoder().decode(b)
  const data = parseTagsTree({
    tree: decode(bytes[0]),
    multilingual: decode(bytes[1]),
    frequency: decode(bytes[2]),
  })

  const info = options.git === false ? NO_GIT : await readGitInfo(repo)
  const license = await readLicense(repo)
  const importedAt = (options.now ?? new Date()).toISOString()
  const log: ImportLogRow[] = []
  for (const [i, f] of files.entries()) {
    log.push({
      seq: 1,
      path: assertRelativePath(f),
      kind: 'tags-tree',
      name: 'tags-tree',
      ...info,
      license,
      dataVersion: data.version,
      importedAt,
      sha256: await sha256(bytes[i]),
      bytes: bytes[i].byteLength,
      rows: f === FREQUENCY_FILE ? data.frequencyRows : null,
    })
  }
  return { data, log }
}
