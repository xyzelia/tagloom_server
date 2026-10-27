// HTTP 接口（挂在 /api/tagloom）。只校验 HTTP 外层；人物内容由 core 的 service 用 zod 校验。
// 路由必须链式写，类型才能传到 TagloomApi；onError 在宿主挂载前设置。
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  type CharacterContent,
  parentOf,
  type SceneContent,
  stemOf,
} from '../../share/mod.ts'
import {
  agentCategoriesInput,
  agentLookupInput,
  agentMatchInput,
  agentSearchInput,
  agentTagsInput,
  TagloomError,
} from '../../core/mod.ts'
import { characterFileSummary } from '../../infra/character-files.ts'
import type { TagloomConfig } from '../config.ts'
import { getTagloomRuntime } from '../runtime.ts'
import { errorBody, handleError } from './errors.ts'

const pathQuery = z.object({ path: z.string().max(2000) })
const limit = (max: number, def: number) =>
  z.coerce.number().int().min(1).max(max).default(def)
const content = z.custom<CharacterContent>(
  (v) => v !== null && typeof v === 'object',
  { message: 'content is required' },
)
const sceneContent = z.custom<SceneContent>(
  (v) => v !== null && typeof v === 'object',
  { message: 'content is required' },
)

const validate = {
  param: <T extends z.ZodType>(schema: T) =>
    zValidator('param', schema, (r, c) => {
      if (!r.success) return c.json(errorBody('not_found', 'not found'), 404)
    }),
  query: <T extends z.ZodType>(schema: T) =>
    zValidator('query', schema, (r, c) => {
      if (!r.success) {
        return c.json(
          errorBody(
            'invalid_request',
            'invalid query',
            z.treeifyError(r.error),
          ),
          422,
        )
      }
    }),
  json: <T extends z.ZodType>(schema: T) =>
    zValidator('json', schema, (r, c) => {
      if (!r.success) {
        return c.json(
          errorBody('invalid_request', 'invalid body', z.treeifyError(r.error)),
          422,
        )
      }
    }),
}

// 下载文件名：非 ASCII 用 RFC 5987 编码
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${
    encodeURIComponent(name)
  }`
}
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)

export function createApi(config: TagloomConfig) {
  const rt = () => getTagloomRuntime(config)

  const catalog = new Hono()
    .get('/status', (c) => c.json(rt().catalog.status(), 200))
    // 全库检索（事实候选）；field 用于标出属于本字段分类的结果并排在前面
    .get(
      '/search',
      validate.query(z.object({
        q: z.string().max(2000),
        field: z.string().max(100).optional(),
        limit: limit(50, 12),
      })),
      (c) => {
        const { q, field, limit } = c.req.valid('query')
        return c.json(rt().catalog.search(q, field, limit), 200)
      },
    )
    // 分类输入框的下拉建议：paths 是这个分类各字段对应的词库分类路径（逗号分隔）
    .get(
      '/segment-search',
      validate.query(z.object({
        q: z.string().max(200),
        paths: z.string().max(4000).default(''),
        limit: limit(50, 15),
      })),
      (c) => {
        const { q, paths, limit } = c.req.valid('query')
        const list = paths.split(',').map((p) => p.trim()).filter(Boolean)
          .slice(0, 100)
        return c.json(rt().catalog.segmentSearch(q, list, limit, 8), 200)
      },
    )
    // 自然语言粗筛：一段描述 → 可能相关的标签（宁多勿漏，带原文依据）、提到的分类、没命中的片段
    .post(
      '/match',
      validate.json(z.object({
        text: z.string().max(8000),
        limit: z.number().int().min(1).max(2000).default(800),
      })),
      (c) => {
        const { text, limit } = c.req.valid('json')
        return c.json(rt().catalog.matchText(text, limit), 200)
      },
    )
    // 浏览词库分类：path 为空列出根分类；否则返回分类信息、上级、子分类和分类内（含后代）的标签
    .get(
      '/category',
      validate.query(z.object({
        path: z.string().max(500).default(''),
        q: z.string().max(200).default(''),
        limit: limit(500, 100),
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
      })),
      (c) => {
        const { path, q, limit, offset } = c.req.valid('query')
        return c.json(rt().catalog.category(path, q, limit, offset), 200)
      },
    )
    // 单个标签的完整信息：分类链（三语）、所在分类的标签数、各来源的原始写法和分类
    .get(
      '/tag',
      validate.query(z.object({ canonical: z.string().min(1).max(500) })),
      (c) =>
        c.json(rt().catalog.tagDetail(c.req.valid('query').canonical), 200),
    )
    // 字段选词列表：只在字段对应的词库分类内
    .get(
      '/field-tags',
      validate.query(z.object({
        field: z.string().max(100),
        q: z.string().max(200).default(''),
        limit: limit(200, 60),
      })),
      (c) => {
        const { field, q, limit } = c.req.valid('query')
        return c.json(rt().catalog.fieldTags(field, q, limit), 200)
      },
    )
    // ── 词库导入（「词库」页）：路径都相对数据源目录（data/data_source） ──
    .get(
      '/admin/status',
      async (c) => c.json(await rt().catalogAdmin.status(), 200),
    )
    .get(
      '/admin/dirs',
      validate.query(z.object({ path: z.string().max(2000).default('') })),
      async (c) =>
        c.json(await rt().catalogAdmin.dirs(c.req.valid('query').path), 200),
    )
    .post(
      '/admin/detect',
      validate.json(z.object({ path: z.string().max(2000) })),
      async (c) =>
        c.json(await rt().catalogAdmin.detect(c.req.valid('json').path), 200),
    )
    .post(
      '/admin/import',
      validate.json(z.object({
        path: z.string().max(2000),
        kind: z.enum(['tags-tree', 'csv']),
        files: z.array(z.string().max(2000)).max(1000).optional(),
        name: z.string().max(200).optional(),
        dataVersion: z.string().max(200).optional(),
        dropCsv: z.boolean().optional(),
      })),
      async (c) =>
        c.json(await rt().catalogAdmin.import(c.req.valid('json')), 200),
    )

  // 人物以 characters/ 下的相对路径区分，路径放在查询参数 path 里（可以含 /）
  const characters = new Hono()
    // 列出一层：子文件夹、人物摘要、不是人物的 JSON 个数
    .get(
      '/',
      validate.query(z.object({ folder: z.string().max(2000).default('') })),
      async (c) =>
        c.json(
          await rt().characters.listFolder(c.req.valid('query').folder),
          200,
        ),
    )
    // 全局搜索（会读一遍还没打开过的文件夹）；q 为空时返回全部
    .get(
      '/search',
      validate.query(z.object({ q: z.string().max(200).default('') })),
      async (c) =>
        c.json(await rt().characters.search(c.req.valid('query').q), 200),
    )
    // 新建：放进 folder（文件名由标题生成），或放在确切的 path（已存在则 409）
    .post(
      '/',
      validate.json(z.object({
        content: content.optional(),
        folder: z.string().max(2000).optional(),
        path: z.string().max(2000).optional(),
      })),
      async (c) => {
        const { content, folder, path } = c.req.valid('json')
        return c.json(
          await rt().characters.create(content, { folder, path }),
          201,
        )
      },
    )
    // 导入人物存档：在 folder 里建立新人物
    .post(
      '/import',
      validate.json(z.object({
        archive: z.unknown(),
        folder: z.string().max(2000).optional(),
      })),
      async (c) => {
        const { archive, folder } = c.req.valid('json')
        return c.json(
          await rt().characters.importProject(archive, { folder }),
          201,
        )
      },
    )
    .get(
      '/item',
      validate.query(pathQuery),
      async (c) =>
        c.json(await rt().characters.get(c.req.valid('query').path), 200),
    )
    .put(
      '/item',
      validate.query(pathQuery),
      validate.json(z.object({
        expectedVersion: z.number().int().min(0),
        content,
      })),
      async (c) => {
        const { expectedVersion, content } = c.req.valid('json')
        const { character, agentMerged } = await rt().characters.update(
          c.req.valid('query').path,
          expectedVersion,
          content,
        )
        // agentMerged 不为 null：保存前合并了 AI 追加，前端应以返回内容为准
        return c.json({ ...character, agentMerged }, 200)
      },
    )
    .delete(
      '/item',
      validate.query(pathQuery.extend({
        expectedVersion: z.coerce.number().int().min(0),
      })),
      async (c) => {
        const { path, expectedVersion } = c.req.valid('query')
        await rt().characters.remove(path, expectedVersion)
        return c.json({ deleted: true }, 200)
      },
    )
    // 移动或改名；目标已存在时 409，不覆盖。返回新路径下的人物
    .post(
      '/item/move',
      validate.query(pathQuery),
      validate.json(z.object({
        expectedVersion: z.number().int().min(0),
        to: z.string().max(2000),
      })),
      async (c) => {
        const { expectedVersion, to } = c.req.valid('json')
        return c.json(
          await rt().characters.move(
            c.req.valid('query').path,
            expectedVersion,
            to,
          ),
          200,
        )
      },
    )
    // 编辑页拉取 since 之后的 AI 追加；期间有其他修改时返回 conflict
    .get(
      '/item/agent-changes',
      validate.query(pathQuery.extend({
        since: z.coerce.number().int().min(0),
      })),
      async (c) => {
        const { path, since } = c.req.valid('query')
        return c.json(await rt().characters.agentChangesSince(path, since), 200)
      },
    )
    // 人物存档（下载）
    .get(
      '/item/export/project',
      validate.query(pathQuery),
      async (c) => {
        const { path } = c.req.valid('query')
        const archive = await rt().characters.exportProject(path)
        const title = safeName(archive.character.title || stemOf(path))
        c.header('Content-Disposition', attachment(`${title}.tagloom.json`))
        return c.json(archive, 200)
      },
    )
    // 下游成品（下载）：format=json（默认）或 text
    .get(
      '/item/export/output',
      validate.query(pathQuery.extend({
        format: z.enum(['json', 'text']).default('json'),
      })),
      async (c) => {
        const { path, format } = c.req.valid('query')
        const svc = rt().characters
        const title = safeName((await svc.get(path)).title || stemOf(path))
        if (format === 'text') {
          c.header('Content-Disposition', attachment(`${title}.prompt.txt`))
          return c.text(await svc.exportOutputText(path), 200)
        }
        c.header('Content-Disposition', attachment(`${title}.output.json`))
        return c.json(await svc.exportOutput(path), 200)
      },
    )

  // 人物目录里的文件夹：新建、移动 / 改名、删除（只能删空的）
  const folders = new Hono()
    .post(
      '/',
      validate.json(pathQuery),
      async (c) =>
        c.json(
          await rt().characters.createFolder(c.req.valid('json').path),
          201,
        ),
    )
    .post(
      '/move',
      validate.json(pathQuery.extend({ to: z.string().max(2000) })),
      async (c) => {
        const { path, to } = c.req.valid('json')
        return c.json(await rt().characters.moveFolder(path, to), 200)
      },
    )
    .delete(
      '/',
      validate.query(pathQuery),
      async (c) => {
        await rt().characters.removeFolder(c.req.valid('query').path)
        return c.json({ deleted: true }, 200)
      },
    )

  // 场景以 scenes/ 下的相对路径区分；接口与人物同构（没有 AI 追加、存档导入）
  const scenes = new Hono()
    .get(
      '/',
      validate.query(z.object({ folder: z.string().max(2000).default('') })),
      async (c) =>
        c.json(await rt().scenes.listFolder(c.req.valid('query').folder), 200),
    )
    // 全文搜索（会读一遍还没打开过的文件夹）；q 为空时返回全部
    .get(
      '/search',
      validate.query(z.object({ q: z.string().max(200).default('') })),
      async (c) =>
        c.json(await rt().scenes.search(c.req.valid('query').q), 200),
    )
    .post(
      '/',
      validate.json(z.object({
        content: sceneContent.optional(),
        folder: z.string().max(2000).optional(),
        path: z.string().max(2000).optional(),
      })),
      async (c) => {
        const { content, folder, path } = c.req.valid('json')
        return c.json(await rt().scenes.create(content, { folder, path }), 201)
      },
    )
    .get(
      '/item',
      validate.query(pathQuery),
      async (c) =>
        c.json(await rt().scenes.get(c.req.valid('query').path), 200),
    )
    .put(
      '/item',
      validate.query(pathQuery),
      validate.json(z.object({
        expectedVersion: z.number().int().min(0),
        content: sceneContent,
      })),
      async (c) => {
        const { expectedVersion, content } = c.req.valid('json')
        return c.json(
          await rt().scenes.update(
            c.req.valid('query').path,
            expectedVersion,
            content,
          ),
          200,
        )
      },
    )
    .delete(
      '/item',
      validate.query(pathQuery.extend({
        expectedVersion: z.coerce.number().int().min(0),
      })),
      async (c) => {
        const { path, expectedVersion } = c.req.valid('query')
        await rt().scenes.remove(path, expectedVersion)
        return c.json({ deleted: true }, 200)
      },
    )
    .post(
      '/item/move',
      validate.query(pathQuery),
      validate.json(z.object({
        expectedVersion: z.number().int().min(0),
        to: z.string().max(2000),
      })),
      async (c) => {
        const { expectedVersion, to } = c.req.valid('json')
        return c.json(
          await rt().scenes.move(
            c.req.valid('query').path,
            expectedVersion,
            to,
          ),
          200,
        )
      },
    )
    // 复制为新场景：缺省放在同一文件夹；也可指定 folder 或确切的 path
    .post(
      '/item/copy',
      validate.query(pathQuery),
      validate.json(z.object({
        folder: z.string().max(2000).optional(),
        path: z.string().max(2000).optional(),
      })),
      async (c) => {
        const { folder, path } = c.req.valid('json')
        const where = folder === undefined && path === undefined
          ? undefined
          : { folder, path }
        return c.json(
          await rt().scenes.copy(c.req.valid('query').path, where),
          201,
        )
      },
    )
    // 下游成品（下载）：format=json（默认）或 text
    .get(
      '/item/export/output',
      validate.query(pathQuery.extend({
        format: z.enum(['json', 'text']).default('json'),
      })),
      async (c) => {
        const { path, format } = c.req.valid('query')
        const svc = rt().scenes
        const title = safeName((await svc.get(path)).title || stemOf(path))
        if (format === 'text') {
          c.header('Content-Disposition', attachment(`${title}.scene.txt`))
          return c.text(await svc.exportOutputText(path), 200)
        }
        c.header('Content-Disposition', attachment(`${title}.scene.json`))
        return c.json(await svc.exportOutput(path), 200)
      },
    )
    // 场景目录里的文件夹：新建、移动 / 改名、删除（只能删空的）
    .post(
      '/folders',
      validate.json(pathQuery),
      async (c) =>
        c.json(await rt().scenes.createFolder(c.req.valid('json').path), 201),
    )
    .post(
      '/folders/move',
      validate.json(pathQuery.extend({ to: z.string().max(2000) })),
      async (c) => {
        const { path, to } = c.req.valid('json')
        return c.json(await rt().scenes.moveFolder(path, to), 200)
      },
    )
    .delete(
      '/folders',
      validate.query(pathQuery),
      async (c) => {
        await rt().scenes.removeFolder(c.req.valid('query').path)
        return c.json({ deleted: true }, 200)
      },
    )

  // 按相对路径浏览硬盘上的所有 JSON（包括不是人物的外部文件）。
  const files = new Hono()
    .get(
      '/',
      validate.query(z.object({ folder: z.string().max(2000).default('') })),
      async (c) =>
        c.json(await rt().files.list(c.req.valid('query').folder), 200),
    )
    .get(
      '/preview',
      validate.query(z.object({ path: z.string().min(1).max(2000) })),
      async (c) => {
        const { content, ...file } = await rt().files.read(
          c.req.valid('query').path,
        )
        return c.json({
          ...file,
          summary: content ? characterFileSummary(content) : null,
        }, 200)
      },
    )
    .post(
      '/import',
      validate.json(z.object({ path: z.string().min(1).max(2000) })),
      async (c) => {
        // 导入时重新读盘，不信任客户端预览；在源文件所在文件夹建立新人物，不覆盖源文件。
        const { path } = c.req.valid('json')
        const file = await rt().files.read(path)
        if (!file.content) {
          throw new TagloomError(
            'invalid_request',
            '文件不是人物数据或人物存档 v2',
          )
        }
        return c.json(
          await rt().characters.create(file.content, {
            folder: parentOf(path),
          }),
          201,
        )
      },
    )

  // 给 AI agent 用的接口（说明见 packages/tagloom/ai-tools/API.md）。首版不鉴权（可信内网）。
  // 词库检索直接用 /catalog/search 与 /catalog/field-tags。
  const agent = new Hono()
    // 所有人物（会读一遍所有文件夹）；q 按标题或路径筛选
    .get(
      '/characters',
      validate.query(z.object({ q: z.string().max(200).default('') })),
      async (c) =>
        c.json(await rt().characters.search(c.req.valid('query').q), 200),
    )
    .get(
      '/character',
      validate.query(pathQuery),
      async (c) =>
        c.json(
          await rt().characters.agentContext(c.req.valid('query').path),
          200,
        ),
    )
    // 批量创建自创标签（来源固定为 agent），可同时作为勾选条目加进分类；内容由 service 校验
    .post(
      '/character/custom-tags',
      validate.query(pathQuery),
      validate.json(z.record(z.string(), z.unknown())),
      async (c) =>
        c.json(
          await rt().characters.agentAddTags(
            c.req.valid('query').path,
            c.req.valid('json'),
          ),
          200,
        ),
    )
    // 词库批量查询（每条各自分页，见 doc/AGENT_CATALOG_API.md）
    .post(
      '/catalog/lookup',
      validate.json(agentLookupInput),
      (c) => c.json(rt().agentCatalog.lookup(c.req.valid('json')), 200),
    )
    .post(
      '/catalog/match',
      validate.json(agentMatchInput),
      (c) => c.json(rt().agentCatalog.match(c.req.valid('json')), 200),
    )
    .post(
      '/catalog/search',
      validate.json(agentSearchInput),
      (c) => c.json(rt().agentCatalog.search(c.req.valid('json')), 200),
    )
    .post(
      '/catalog/tags',
      validate.json(agentTagsInput),
      (c) => c.json(rt().agentCatalog.tags(c.req.valid('json')), 200),
    )
    .post(
      '/catalog/categories',
      validate.json(agentCategoriesInput),
      (c) => c.json(rt().agentCatalog.categories(c.req.valid('json')), 200),
    )

  return new Hono()
    .route('/catalog', catalog)
    .route('/characters', characters)
    .route('/folders', folders)
    .route('/scenes', scenes)
    .route('/files', files)
    .route('/agent', agent)
    .onError(handleError)
}

export type { ApiErrorBody, ApiErrorCode } from './errors.ts'
