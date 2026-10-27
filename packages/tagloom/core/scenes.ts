// 场景：存储接口与业务规则（保存带版本号、新建 / 复制 / 移动 / 删除、全文搜索、下游成品导出）。
// 身份与目录规则同人物：scenes/ 下的相对路径，新建由标题生成文件名，重名加序号，新建和移动都不覆盖已有文件。
// 人物快照由前端用 share 的 buildSlotSnapshot 生成，这里只校验结构，不回读人物。
import type { z } from 'zod'
import {
  buildSceneOutput,
  buildSceneText,
  cleanSceneParams,
  detectFormat,
  emptySceneContent,
  fileStemFor,
  isSameOrInside,
  joinPath,
  nameOf,
  numberedName,
  parentOf,
  type Scene,
  type SceneContent,
  sceneContentOf,
  sceneDisplayTitle,
  type SceneOutput,
  withoutFormat,
} from '../share/mod.ts'
import { sceneContentSchema } from './schema.ts'
import { TagloomError } from './errors.ts'
import { exists, invalid, pathRules, serializer } from './doc-paths.ts'
import type { FolderEntry } from './characters.ts'

export interface SceneSummary {
  path: string
  version: number
  title: string
  slotCount: number
  updatedAt: number
}

export interface SceneFolderListing {
  folder: string
  folders: FolderEntry[]
  scenes: SceneSummary[]
  // 不是场景的 JSON 文件个数
  otherFiles: number
}

export interface SceneCreateWhere {
  folder?: string
  path?: string
}

// 磁盘上的 JSON 是否是场景：格式标记为 tagloom.scene v1，有整数 version >= 1、createdAt、updatedAt，内容通过 schema
export function storedScene(value: unknown, path: string): Scene | null {
  if (detectFormat(value) !== 'scene') return null
  const { path: _path, ...s } = withoutFormat(value as Scene)
  if (
    !Number.isInteger(s.version) || s.version < 1 ||
    !Number.isSafeInteger(s.updatedAt) || !Number.isSafeInteger(s.createdAt)
  ) return null
  if (!sceneContentSchema.safeParse(s).success) return null
  return { ...s, path }
}

export function sceneSummaryOf(s: Scene): SceneSummary {
  return {
    path: s.path,
    version: s.version,
    title: sceneDisplayTitle(s),
    slotCount: s.slots.length,
    updatedAt: s.updatedAt,
  }
}

// 全文搜索文本（小写）：标题、备注、负面、条目、自创标签、槽位名称与快照
export function sceneSearchText(s: Scene): string {
  const segText = (items: Scene['content']['items']) => items.map((i) => i.text)
  return [
    s.title,
    s.note,
    s.negativePrompt,
    ...segText(s.content.items),
    ...s.customTags.flatMap((t) => [t.text, t.label]),
    ...s.slots.flatMap((slot) => [
      slot.label,
      ...segText(slot.extra.items),
      ...(slot.snapshot
        ? [
          slot.snapshot.title,
          slot.snapshot.characterPath,
          slot.snapshot.comboName,
          slot.snapshot.stateName,
          slot.snapshot.subject,
          slot.snapshot.base,
          slot.snapshot.costume,
          slot.snapshot.expression,
          slot.snapshot.action,
        ]
        : []),
    ]),
  ].filter(Boolean).join('\n').toLowerCase()
}

// 存储接口：只负责读写磁盘（原子写入、不覆盖），版本检查和命名规则由 service 做
export interface SceneRepo {
  listFolder(folder: string): Promise<SceneFolderListing>
  // 递归列出所有场景，附带全文搜索文本
  listAll(): Promise<{ summary: SceneSummary; text: string }[]>
  get(path: string): Promise<Scene | undefined>
  put(scene: Scene): Promise<void>
  create(scene: Scene): Promise<boolean>
  move(from: string, to: string): Promise<boolean>
  remove(path: string): Promise<boolean>
  createFolder(path: string): Promise<boolean>
  moveFolder(from: string, to: string): Promise<boolean>
  removeFolder(path: string): Promise<'removed' | 'not_empty'>
}

export interface SceneServiceDeps {
  repo: SceneRepo
  now?: () => number
}

const MAX_NAME_TRIES = 200

const { checkFile, checkFolder, checkNewName } = pathRules('场景')

function summarize(error: z.ZodError) {
  return error.issues.slice(0, 20).map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }))
}

function parseContent(input: unknown): SceneContent {
  const result = sceneContentSchema.safeParse(input)
  if (!result.success) {
    throw new TagloomError('invalid_request', 'invalid scene content', {
      issues: summarize(result.error),
    })
  }
  // 空的参数项不存；一项都没有就不写 params 键
  const { params, ...rest } = result.data
  const cleaned = cleanSceneParams(params)
  return cleaned ? { ...rest, params: cleaned } : rest
}

const conflict = (current: Scene) =>
  new TagloomError('version_conflict', 'scene was modified', {
    currentVersion: current.version,
  })

export function createSceneService(deps: SceneServiceDeps) {
  const { repo } = deps
  const now = deps.now ?? Date.now
  const serial = serializer()

  async function mustGet(path: string): Promise<Scene> {
    checkFile(path)
    const s = await repo.get(path)
    if (!s) throw new TagloomError('not_found', `scene ${path} not found`)
    return s
  }

  // where.path：放在这个确切位置（已存在则报 already_exists）；
  // 否则放进 where.folder（默认根目录），文件名由标题生成，重名时加序号
  function create(
    content: SceneContent,
    where: SceneCreateWhere = {},
  ): Promise<Scene> {
    if (where.path !== undefined) checkNewName(where.path, true)
    else checkFolder(where.folder ?? '')
    return serial(async () => {
      const t = now()
      const fields = { ...content, version: 1, createdAt: t, updatedAt: t }
      if (where.path !== undefined) {
        const s: Scene = { ...fields, path: where.path }
        if (!(await repo.create(s))) throw exists(where.path)
        return s
      }
      const stem = fileStemFor(sceneDisplayTitle(content))
      for (let n = 1; n <= MAX_NAME_TRIES; n++) {
        const s: Scene = {
          ...fields,
          path: joinPath(where.folder ?? '', numberedName(stem, n)),
        }
        if (await repo.create(s)) return s
      }
      throw invalid(`同名文件太多，请换个标题：${stem}`)
    })
  }

  return {
    listFolder(folder: string): Promise<SceneFolderListing> {
      checkFolder(folder)
      return repo.listFolder(folder)
    },

    // 全文搜索：会把还没打开过的文件夹也读一遍。q 为空时返回全部；
    // 匹配路径、标题、备注、条目文本、自创标签、槽位名称与人物快照（不分大小写）
    async search(q: string): Promise<SceneSummary[]> {
      const needle = q.trim().toLowerCase()
      const all = await repo.listAll()
      return all
        .filter(({ summary, text }) =>
          !needle || text.includes(needle) ||
          summary.title.toLowerCase().includes(needle) ||
          summary.path.toLowerCase().includes(needle)
        )
        .map((d) => d.summary)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },

    get: mustGet,

    create(input?: unknown, where?: SceneCreateWhere): Promise<Scene> {
      return create(
        input === undefined ? emptySceneContent() : parseContent(input),
        where,
      )
    },

    // 复制为新场景：缺省放在同一文件夹，标题加「副本」
    async copy(path: string, where?: SceneCreateWhere): Promise<Scene> {
      const source = sceneContentOf(await mustGet(path))
      return create(
        { ...source, title: `${sceneDisplayTitle(source)} 副本` },
        where ?? { folder: parentOf(path) },
      )
    },

    update(
      path: string,
      expectedVersion: number,
      input: unknown,
    ): Promise<Scene> {
      const content = parseContent(input)
      return serial(async () => {
        const current = await mustGet(path)
        if (current.version !== expectedVersion) throw conflict(current)
        // params 是可选键：新内容没有就是清空，不能沿用旧值
        const { params: _old, ...base } = current
        const next: Scene = {
          ...base,
          ...content,
          version: current.version + 1,
          updatedAt: now(),
        }
        await repo.put(next)
        return next
      })
    },

    remove(path: string, expectedVersion: number): Promise<void> {
      return serial(async () => {
        const current = await mustGet(path)
        if (current.version !== expectedVersion) throw conflict(current)
        await repo.remove(path)
      })
    },

    move(path: string, expectedVersion: number, to: string): Promise<Scene> {
      checkFile(path)
      checkNewName(to, true)
      return serial(async () => {
        const current = await mustGet(path)
        if (current.version !== expectedVersion) throw conflict(current)
        if (to === path) return current
        if (!(await repo.move(path, to))) throw exists(to)
        return { ...current, path: to }
      })
    },

    createFolder(path: string): Promise<FolderEntry> {
      checkNewName(path, false)
      return serial(async () => {
        if (!(await repo.createFolder(path))) throw exists(path)
        return { name: nameOf(path), path }
      })
    },

    moveFolder(path: string, to: string): Promise<FolderEntry> {
      checkNewName(path, false)
      checkNewName(to, false)
      const caseOnly = to !== path && to.toLowerCase() === path.toLowerCase()
      if (!caseOnly && to !== path && isSameOrInside(to, path)) {
        throw invalid('不能把文件夹移到它自己里面')
      }
      return serial(async () => {
        if (to !== path && !(await repo.moveFolder(path, to))) throw exists(to)
        return { name: nameOf(to), path: to }
      })
    },

    removeFolder(path: string): Promise<void> {
      checkFolder(path)
      if (!path) throw invalid('不能删除根目录')
      return serial(async () => {
        if ((await repo.removeFolder(path)) === 'not_empty') {
          throw invalid('文件夹不是空的，请先移走或删除里面的场景和文件')
        }
      })
    },

    async exportOutput(path: string): Promise<SceneOutput> {
      return buildSceneOutput(await mustGet(path), now())
    },

    async exportOutputText(path: string): Promise<string> {
      return buildSceneText(await mustGet(path))
    },
  }
}

export type SceneService = ReturnType<typeof createSceneService>
