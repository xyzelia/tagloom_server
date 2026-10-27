// 组装点 + 进程级单例：人物 / 场景 JSON 存储、只读词库。
// 挂在 globalThis 上，Vite 热更新重新执行模块时复用同一个词库连接和同一个写入队列。
// 词库打不开不算初始化失败：记下原因，检索接口返回「未进行数据库核查」，其余功能照常。
// 在「词库」页导入后会重新加载词库（reloadCatalog），catalog / agentCatalog 随之换成新的。
import {
  type AgentCatalogService,
  type CatalogService,
  type CharacterService,
  createAgentCatalogService,
  createCatalogService,
  createCharacterService,
  createSceneService,
  type SceneService,
} from '../core/mod.ts'
import {
  createJsonCharacterRepo,
  createJsonSceneRepo,
  openSqliteCatalog,
} from '../infra/mod.ts'
import type { TagloomConfig } from './config.ts'
import {
  type CharacterFiles,
  createCharacterFiles,
} from '../infra/character-files.ts'
import { type CatalogAdmin, createCatalogAdmin } from './catalog-admin.ts'

export interface TagloomRuntime {
  characters: CharacterService
  scenes: SceneService
  files: CharacterFiles
  catalog: CatalogService
  agentCatalog: AgentCatalogService
  catalogAdmin: CatalogAdmin
  // 重新打开词库；失败时继续用原来的，返回原因（成功时为 ''）
  reloadCatalog(): string
  close(): void
}

interface Slot {
  dataDir: string
  runtime: TagloomRuntime
}

const KEY = Symbol.for('app.tagloom.runtime')
const g = globalThis as { [KEY]?: Slot }

export function getTagloomRuntime(config: TagloomConfig): TagloomRuntime {
  const existing = g[KEY]
  if (existing) {
    if (existing.dataDir !== config.dataDir) {
      throw new Error(
        `tagloom runtime already initialized with dataDir ${existing.dataDir}`,
      )
    }
    return existing.runtime
  }
  const runtime = createRuntime(config)
  g[KEY] = { dataDir: config.dataDir, runtime }
  return runtime
}

export function closeTagloomRuntime(): void {
  const slot = g[KEY]
  if (!slot) return
  delete g[KEY]
  slot.runtime.close()
}

type Catalog = ReturnType<typeof openSqliteCatalog>

// 打开词库；失败时返回给页面看的原因（不含绝对路径，只给出文件名和原因）
function openCatalog(
  config: TagloomConfig,
  catalogPath: string,
): { catalog: Catalog | null; reason: string } {
  try {
    return {
      catalog: openSqliteCatalog({
        path: catalogPath,
        allowRestricted: config.allowRestricted,
      }),
      reason: '',
    }
  } catch (e) {
    const name = catalogPath.split(/[\\/]/).pop()
    console.warn(
      `[tagloom] tag catalog unavailable (${catalogPath}): ${
        e instanceof Error ? e.message : e
      }`,
    )
    return {
      catalog: null,
      reason: `词库 ${name} 无法打开：${
        e instanceof Error ? e.message.replace(/:.*$/, '') : String(e)
      }`,
    }
  }
}

function createRuntime(config: TagloomConfig): TagloomRuntime {
  const dataDir = config.dataDir.replace(/[\\/]+$/, '')
  const catalogPath = config.catalogPath ?? `${dataDir}/tag_catalog.sqlite`
  let { catalog, reason } = openCatalog(config, catalogPath)
  const runtime: TagloomRuntime = {
    characters: createCharacterService({
      repo: createJsonCharacterRepo(`${dataDir}/characters`),
    }),
    scenes: createSceneService({
      repo: createJsonSceneRepo(`${dataDir}/scenes`),
    }),
    files: createCharacterFiles(`${dataDir}/characters`),
    catalog: createCatalogService(catalog, reason),
    agentCatalog: createAgentCatalogService(catalog, reason),
    catalogAdmin: createCatalogAdmin({
      catalogPath,
      sourceDir: config.sourceDir ?? `${dataDir}/../data_source`,
      status: () => runtime.catalog.status(),
      reload: () => runtime.reloadCatalog(),
    }),
    reloadCatalog() {
      const next = openCatalog(config, catalogPath)
      // 新词库打不开：继续用原来的（原来也没有时记下新的原因）
      if (!next.catalog && catalog) return next.reason
      catalog?.close()
      catalog = next.catalog
      reason = next.reason
      runtime.catalog = createCatalogService(catalog, reason)
      runtime.agentCatalog = createAgentCatalogService(catalog, reason)
      return reason
    },
    close: () => catalog?.close(),
  }
  return runtime
}
