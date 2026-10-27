// 人物：存储接口与业务规则（保存带版本号、人物存档导入导出、下游成品导出、AI agent 追加）。
// 冲突提示（share/warnings.ts）只给前端展示，不影响保存、导入或导出。
//
// 身份与目录：人物以 characters/ 下的相对路径区分（share/paths.ts），可以放在任意层的子文件夹里。
// 新建时由标题生成文件名，重名时加 (2)、(3)……；新建和移动都不会覆盖已有文件。
//
// 版本与 AI 写入：
// - 每次写入（用户保存或 AI 追加）版本号都加 1；userVersion 是最近一次用户保存的版本。
// - AI 追加记录在 agentChanges 里；用户保存成功后清空。
// - 用户保存时 expectedVersion 落后，但从那之后只有 AI 追加（expectedVersion >= userVersion）：
//   把这些 AI 变更合并进提交的内容后保存，不报冲突。其他情况照常 version_conflict。
import type { z } from 'zod'
import {
  type AgentChange,
  applyAgentChanges,
  ARCHIVE_VERSION,
  buildOutputArchive,
  buildOutputText,
  buildProjectArchive,
  type Character,
  type CharacterContent,
  contentOf,
  createCustomTag,
  type CustomTag,
  detectFormat,
  displayTitle,
  emptyContent,
  fieldDef,
  fileStemFor,
  findSegment,
  isSameOrInside,
  joinPath,
  nameOf,
  newId as newItemId,
  numberedName,
  type OutputArchive,
  PROJECT_FORMAT,
  type ProjectArchive,
  type PromptItem,
  withoutFormat,
} from '../share/mod.ts'
import { characterContentSchema } from './schema.ts'
import { TagloomError } from './errors.ts'
import { exists, invalid, pathRules, serializer } from './doc-paths.ts'
import {
  agentAddTagsInput,
  type AgentAddTagsResult,
  agentContext,
  MAX_PENDING_AGENT_CHANGES,
} from './agent.ts'

export { TagloomError, type TagloomErrorCode } from './errors.ts'

export interface CharacterSummary {
  path: string
  version: number
  title: string
  comboCount: number
  updatedAt: number
}

export interface FolderEntry {
  name: string
  path: string
}

// 一层目录：子文件夹、人物，以及不是人物的 JSON 文件个数（在文件浏览页查看）
export interface FolderListing {
  folder: string
  folders: FolderEntry[]
  characters: CharacterSummary[]
  otherFiles: number
}

export interface CreateWhere {
  folder?: string
  path?: string
}

// 磁盘上的 JSON 是否是本工具管理的人物：格式标记为 tagloom.character v2，或没有 format（标记之前的旧文件），
// 有整数 version >= 1 和 updatedAt，内容通过 schema。不是人物时返回 null（只在文件浏览页出现）。
// 旧文件里的 id 字段忽略；缺的 stylePrompt / negativePrompt / combo.states / 格式标记只在内存中补，不改写磁盘。
export function storedCharacter(
  value: unknown,
  path: string,
): Character | null {
  if (detectFormat(value) !== 'character') return null
  const { id: _id, path: _path, ...c } = withoutFormat(
    value as Character & { id?: unknown },
  )
  // 改为毫秒之前的旧文件用 ISO 字符串记时间：读的时候换算，下次保存时写成毫秒
  for (const key of ['createdAt', 'updatedAt'] as const) {
    const t: unknown = c[key]
    if (typeof t === 'string' && !Number.isNaN(Date.parse(t))) {
      c[key] = Date.parse(t)
    }
  }
  if (
    !Number.isInteger(c.version) || c.version < 1 ||
    !Number.isSafeInteger(c.updatedAt)
  ) return null
  if (c.stylePrompt === undefined) c.stylePrompt = ''
  if (c.negativePrompt === undefined) c.negativePrompt = ''
  if (Array.isArray(c.combos)) {
    c.combos = c.combos.map((combo) =>
      combo && typeof combo === 'object' && combo.states === undefined
        ? { ...combo, states: [] }
        : combo
    )
  }
  if (!characterContentSchema.safeParse(c).success) return null
  return { ...c, path }
}

export function summaryOf(c: Character): CharacterSummary {
  return {
    path: c.path,
    version: c.version,
    title: displayTitle(c),
    comboCount: c.combos.length,
    updatedAt: c.updatedAt,
  }
}

// 保存结果：agentMerged 不为 null 时表示保存前合并了别处的 AI 追加，前端应以返回内容为准
export interface UpdateResult {
  character: Character
  agentMerged: { tags: number; items: number; skipped: string[] } | null
}

// 编辑页拉取 AI 变更：只有 AI 追加时返回变更；有其他修改时 conflict = true
export type AgentChangesResult =
  | { conflict: false; version: number; changes: AgentChange[] }
  | { conflict: true; version: number }

// 存储接口：只负责读写磁盘（原子写入、不覆盖），版本检查和命名规则由 service 做。
// 路径格式由 service 先校验；repo 还要防符号链接和路径逃逸。
export interface CharacterRepo {
  // 列出一层；文件夹不存在时抛 not_found
  listFolder(folder: string): Promise<FolderListing>
  // 递归列出所有人物（全局搜索、AI 列表）
  listAll(): Promise<CharacterSummary[]>
  get(path: string): Promise<Character | undefined>
  // 覆盖已有人物；文件已不存在时抛 not_found，不会在原位置重新建一个
  put(character: Character): Promise<void>
  // 新建；目标已存在返回 false
  create(character: Character): Promise<boolean>
  // 目标已存在返回 false；只改大小写也可以
  move(from: string, to: string): Promise<boolean>
  remove(path: string): Promise<boolean>
  // 文件夹已存在返回 false
  createFolder(path: string): Promise<boolean>
  moveFolder(from: string, to: string): Promise<boolean>
  // 只删除空文件夹（里面有任何文件都不算空）
  removeFolder(path: string): Promise<'removed' | 'not_empty'>
}

export interface CharacterServiceDeps {
  repo: CharacterRepo
  now?: () => number
}

// 一次新建最多尝试多少个带序号的文件名
const MAX_NAME_TRIES = 200

function parseContent(input: unknown): CharacterContent {
  const result = characterContentSchema.safeParse(input)
  if (!result.success) {
    throw new TagloomError('invalid_request', 'invalid character content', {
      issues: summarize(result.error),
    })
  }
  return result.data
}

function summarize(error: z.ZodError) {
  return error.issues.slice(0, 20).map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }))
}

const { checkFile, checkFolder, checkNewName } = pathRules('人物')

const conflict = (current: Character) =>
  new TagloomError('version_conflict', 'character was modified', {
    currentVersion: current.version,
  })

export function createCharacterService(deps: CharacterServiceDeps) {
  const { repo } = deps
  const now = deps.now ?? Date.now
  const serial = serializer()

  async function mustGet(path: string): Promise<Character> {
    checkFile(path)
    const c = await repo.get(path)
    if (!c) throw new TagloomError('not_found', `character ${path} not found`)
    return c
  }

  // where.path：放在这个确切位置（已存在则报 already_exists）；
  // 否则放进 where.folder（默认根目录），文件名由标题生成，重名时加序号
  function create(
    content: CharacterContent,
    where: CreateWhere = {},
  ): Promise<Character> {
    if (where.path !== undefined) checkNewName(where.path, true)
    else checkFolder(where.folder ?? '')
    return serial(async () => {
      const t = now()
      const fields = {
        ...content,
        version: 1,
        createdAt: t,
        updatedAt: t,
        userVersion: 1,
        agentChanges: [],
      }
      if (where.path !== undefined) {
        const c: Character = { ...fields, path: where.path }
        if (!(await repo.create(c))) throw exists(where.path)
        return c
      }
      const stem = fileStemFor(displayTitle(content))
      for (let n = 1; n <= MAX_NAME_TRIES; n++) {
        const c: Character = {
          ...fields,
          path: joinPath(where.folder ?? '', numberedName(stem, n)),
        }
        if (await repo.create(c)) return c
      }
      throw invalid(`同名文件太多，请换个标题：${stem}`)
    })
  }

  return {
    listFolder(folder: string): Promise<FolderListing> {
      checkFolder(folder)
      return repo.listFolder(folder)
    },

    // 全局搜索：会把还没打开过的文件夹也读一遍。q 为空时返回全部；按标题或路径匹配，不分大小写
    async search(q: string): Promise<CharacterSummary[]> {
      const needle = q.trim().toLowerCase()
      const all = await repo.listAll()
      return all
        .filter((c) =>
          !needle || c.title.toLowerCase().includes(needle) ||
          c.path.toLowerCase().includes(needle)
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },

    get: mustGet,

    create(input?: unknown, where?: CreateWhere): Promise<Character> {
      return create(
        input === undefined ? emptyContent() : parseContent(input),
        where,
      )
    },

    // 移动或改名人物文件；目标已存在时报 already_exists，不覆盖
    move(
      path: string,
      expectedVersion: number,
      to: string,
    ): Promise<Character> {
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

    // 移动或改名文件夹（连同里面的所有东西）
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
          throw invalid('文件夹不是空的，请先移走或删除里面的人物和文件')
        }
      })
    },

    // 用户保存（编辑页）
    update(
      path: string,
      expectedVersion: number,
      input: unknown,
    ): Promise<UpdateResult> {
      let content = parseContent(input)
      return serial(async () => {
        const current = await mustGet(path)
        let agentMerged: UpdateResult['agentMerged'] = null
        if (current.version !== expectedVersion) {
          // 只有 AI 追加时自动合并；否则是真正的并发修改
          if (
            expectedVersion < current.userVersion ||
            expectedVersion > current.version
          ) throw conflict(current)
          const pending = current.agentChanges.filter((ch) =>
            ch.version > expectedVersion
          )
          const r = applyAgentChanges(content, pending)
          content = r.content
          agentMerged = {
            tags: r.tagsAdded,
            items: r.itemsAdded,
            skipped: r.skipped,
          }
        }
        const version = current.version + 1
        const next: Character = {
          ...current,
          ...content,
          version,
          userVersion: version,
          agentChanges: [],
          updatedAt: now(),
        }
        await repo.put(next)
        return { character: next, agentMerged }
      })
    },

    remove(path: string, expectedVersion: number): Promise<void> {
      return serial(async () => {
        const current = await mustGet(path)
        if (current.version !== expectedVersion) throw conflict(current)
        await repo.remove(path)
      })
    },

    // 编辑页拉取 since 之后的 AI 变更
    async agentChangesSince(
      path: string,
      since: number,
    ): Promise<AgentChangesResult> {
      const c = await mustGet(path)
      if (since > c.version) {
        throw new TagloomError(
          'invalid_request',
          'since is newer than the character',
        )
      }
      if (since < c.userVersion) return { conflict: true, version: c.version }
      return {
        conflict: false,
        version: c.version,
        changes: c.agentChanges.filter((ch) => ch.version > since),
      }
    },

    async agentContext(path: string) {
      return agentContext(await mustGet(path))
    },

    // AI agent 追加标签（可同时作为勾选条目加进分类）。来源由服务端写死为 agent。
    agentAddTags(path: string, input: unknown): Promise<AgentAddTagsResult> {
      const parsed = agentAddTagsInput.safeParse(input)
      if (!parsed.success) {
        throw new TagloomError('invalid_request', 'invalid agent request', {
          issues: summarize(parsed.error),
        })
      }
      const { agentName, tags } = parsed.data
      return serial(async () => {
        const current = await mustGet(path)
        if (current.agentChanges.length >= MAX_PENDING_AGENT_CHANGES) {
          throw new TagloomError(
            'pending_limit',
            `too many pending agent changes (${MAX_PENDING_AGENT_CHANGES}); the user needs to save the character first`,
          )
        }
        const t = now()
        const result: AgentAddTagsResult = {
          version: current.version,
          created: [],
          reused: [],
          items: [],
          skipped: [],
        }
        const library = [...current.customTags]
        const newTags: CustomTag[] = []
        const newItems: AgentChange['items'] = []
        const norm = (s: string) => s.trim().toLowerCase()

        for (const input of tags) {
          const badFields = (input.fields ?? []).filter((f) => !fieldDef(f))
          if (badFields.length) {
            result.skipped.push(
              `「${input.text}」：未知字段 ${badFields.join(', ')}`,
            )
            continue
          }
          let tag = library.find((x) => norm(x.text) === norm(input.text))
          if (tag) {
            result.reused.push({ id: tag.id, text: tag.text })
          } else {
            tag = createCustomTag(input, { origin: 'agent', agentName }, t)
            library.push(tag)
            newTags.push(tag)
            result.created.push({
              id: tag.id,
              text: tag.text,
              label: tag.label,
            })
          }
          for (const target of input.addTo ?? []) {
            const ref = findSegment(current, target.segment)
            if (!ref) {
              result.skipped.push(
                `「${tag.text}」：分类 ${target.segment} 不存在`,
              )
              continue
            }
            const segFields = new Set(ref.def.fields.map((f) => f.key))
            if (target.field && !segFields.has(target.field)) {
              result.skipped.push(
                `「${tag.text}」：字段 ${target.field} 不属于分类 ${target.segment}`,
              )
              continue
            }
            const field = target.field ?? tag.fields.find((f) =>
              segFields.has(f)
            ) ?? null
            const item: PromptItem = {
              origin: 'agent',
              agentName,
              createdAt: t,
              id: newItemId(),
              source: { kind: 'custom', customId: tag.id },
              field,
              text: tag.text,
              included: true,
              factId: null,
            }
            newItems.push({ segment: target.segment, item })
            result.items.push({ segment: target.segment, text: tag.text })
          }
        }

        if (!newTags.length && !newItems.length) return result
        const version = current.version + 1
        const change: AgentChange = {
          version,
          agentName,
          at: t,
          tags: newTags,
          items: newItems,
        }
        const merged = applyAgentChanges(contentOf(current), [change])
        result.skipped.push(...merged.skipped)
        const next: Character = {
          ...current,
          ...merged.content,
          version,
          agentChanges: [...current.agentChanges, change],
          updatedAt: t,
        }
        await repo.put(next)
        result.version = version
        return result
      })
    },

    async exportProject(path: string): Promise<ProjectArchive> {
      return buildProjectArchive(await mustGet(path), now())
    },

    // 导入人物存档：总是建立新人物（新文件），不与已有人物合并
    importProject(archive: unknown, where?: CreateWhere): Promise<Character> {
      if (
        !archive || typeof archive !== 'object' ||
        (archive as { format?: unknown }).format !== PROJECT_FORMAT ||
        (archive as { formatVersion?: unknown }).formatVersion !==
          ARCHIVE_VERSION
      ) {
        throw new TagloomError(
          'invalid_request',
          `not a ${PROJECT_FORMAT} v${ARCHIVE_VERSION} archive`,
        )
      }
      // 内层人物不带格式标记（外层已标明）；带了也接受
      const { character } = archive as { character?: unknown }
      return create(
        parseContent(
          character && typeof character === 'object'
            ? withoutFormat(character)
            : character,
        ),
        where,
      )
    },

    async exportOutput(path: string): Promise<OutputArchive> {
      return buildOutputArchive(await mustGet(path), now())
    },

    async exportOutputText(path: string): Promise<string> {
      return buildOutputText(await mustGet(path))
    },
  }
}

export type CharacterService = ReturnType<typeof createCharacterService>
