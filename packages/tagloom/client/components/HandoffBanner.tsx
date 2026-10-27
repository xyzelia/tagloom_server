// 场景：检测 Prompt 包暂存区（@app/shared/prompt-bundle，localStorage）里没处理过的内容，提示导入。
// 不知道是哪个模块发来的，只认格式；自己发出的不显示。导入或忽略后不再提示这一条；别的标签页发送时通过 storage 事件立即出现。
// - 场景列表：导入为新场景（建在当前文件夹，内容全部带入，之后可手动整理）。
// - 场景编辑：导入到当前场景，走和图片导入相同的确认弹窗（追加 / 替换、按组勾选）。
import { useEffect, useState } from 'react'
import {
  HANDOFF_STORAGE_KEY,
  type HandoffEntry,
  markHandoffConsumed,
  pendingHandoffs,
} from '@app/shared/prompt-bundle'
import {
  applySceneImport,
  emptySceneContent,
  type SceneContent,
  type SceneImportGroup,
  sourceFromBundle,
} from '@app/tagloom/share'
import {
  type PendingSceneImport,
  prepareSceneImport,
  SceneImportModal,
} from './SceneImport.tsx'

const CONSUMER = 'tagloom'

// 隐私模式等情况下 localStorage 可能不可用：当作没有内容
function readPending(): HandoffEntry[] {
  try {
    return pendingHandoffs(localStorage, CONSUMER, Date.now())
  } catch {
    return []
  }
}

function useHandoffs() {
  const [entries, setEntries] = useState(readPending)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === HANDOFF_STORAGE_KEY) {
        setEntries(readPending())
      }
    }
    globalThis.addEventListener('storage', onStorage)
    return () => globalThis.removeEventListener('storage', onStorage)
  }, [])
  const done = (id: string) => {
    try {
      markHandoffConsumed(localStorage, id, CONSUMER, Date.now())
    } catch {
      // 写不进去时下次进页面还会提示
    }
    setEntries(readPending())
  }
  return { entries, done }
}

function ago(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  return `${Math.floor(min / 60)} 小时前`
}

function Banner(props: {
  entries: HandoffEntry[]
  importLabel: string
  busy: boolean
  error: string | null
  onImport: (e: HandoffEntry) => void
  onIgnore: (e: HandoffEntry) => void
}) {
  const entry = props.entries[0]
  if (!entry) return null
  return (
    <div className='notification is-info is-light py-2 px-3 mb-4'>
      <div className='is-flex is-flex-wrap-wrap is-align-items-center is-justify-content-space-between'>
        <span className='mr-2'>
          暂存区有一份来自 {entry.from.label} 的「{entry.bundle.title}」（
          {ago(entry.createdAt)}，{entry.bundle.characters.length} 个人物）
          {props.entries.length > 1 && `，另有 ${props.entries.length - 1} 份`}
        </span>
        <span className='buttons mb-0'>
          <button
            type='button'
            className={`button is-small is-info mb-0${
              props.busy ? ' is-loading' : ''
            }`}
            disabled={props.busy}
            onClick={() => props.onImport(entry)}
          >
            {props.importLabel}
          </button>
          <button
            type='button'
            className='button is-small mb-0'
            disabled={props.busy}
            onClick={() => props.onIgnore(entry)}
          >
            忽略
          </button>
        </span>
      </div>
      {props.error && (
        <p className='help is-danger' role='alert'>{props.error}</p>
      )}
    </div>
  )
}

const ALL_GROUPS: ReadonlySet<SceneImportGroup> = new Set([
  'content',
  'negative',
  'characters',
  'params',
])

// 场景列表：导入为新场景。create 由页面提供（新建并跳转到编辑页）
export function HandoffNewScene(props: {
  create: (content: SceneContent) => Promise<void>
}) {
  const { entries, done } = useHandoffs()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onImport = async (e: HandoffEntry) => {
    setBusy(true)
    setError(null)
    try {
      const { plan } = await prepareSceneImport(sourceFromBundle(e.bundle))
      const content = applySceneImport(
        emptySceneContent(e.bundle.title),
        plan,
        ALL_GROUPS,
        'replace',
      )
      await props.create(content)
      done(e.id)
    } catch (err) {
      setError(
        `导入失败：${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Banner
      entries={entries}
      importLabel='导入为新场景'
      busy={busy}
      error={error}
      onImport={onImport}
      onIgnore={(e) => done(e.id)}
    />
  )
}

// 场景编辑：导入到当前场景
export function HandoffIntoScene(props: {
  draft: SceneContent
  onApply: (fn: (c: SceneContent) => SceneContent) => void
}) {
  const { entries, done } = useHandoffs()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<
    { entry: HandoffEntry; pending: PendingSceneImport } | null
  >(null)
  const onImport = async (e: HandoffEntry) => {
    setBusy(true)
    try {
      const { plan, problem } = await prepareSceneImport(
        sourceFromBundle(e.bundle),
      )
      setOpen({
        entry: e,
        pending: {
          name: e.bundle.title,
          url: null,
          tags: [{ label: 'Prompt 包' }, { label: `来自 ${e.from.label}` }],
          hints: [],
          plan,
          problem,
        },
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Banner
        entries={entries}
        importLabel='导入到当前场景'
        busy={busy}
        error={null}
        onImport={onImport}
        onIgnore={(e) => done(e.id)}
      />
      {open && (
        <SceneImportModal
          key={open.entry.id}
          pending={open.pending}
          draft={props.draft}
          onCancel={() => setOpen(null)}
          onApply={(groups, mode) => {
            const { plan } = open.pending
            props.onApply((c) => applySceneImport(c, plan, groups, mode))
            done(open.entry.id)
            setOpen(null)
          }}
        />
      )}
    </>
  )
}
