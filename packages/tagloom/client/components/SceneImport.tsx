// 场景编辑：从 NovelAI 图片导入。把图片拖到页面任意位置 / 点按钮选择 → 读元数据（浏览器里，不上传）→ 词库核对 → 弹窗确认 → 写进草稿。
// 只显示一个按钮（放在顶部操作栏），不占一整行。场景列表拖入图片时先新建场景，图片经 stashSceneImage 交给编辑页接着导入。
// 确认弹窗（SceneImportModal）和准备函数（prepareSceneImport）也给暂存区导入（HandoffBanner）用。
// 点「导入」之前场景不变；导入后和其他修改一样，点「保存」才写文件。
import { type ReactNode, useEffect, useId, useState } from 'react'
import { parseNovelaiPng } from '@app/shared/novelai'
import {
  applySceneImport,
  type ImportPiece,
  MAX_SCENE_SLOTS,
  planSceneImport,
  SCENE_PARAM_KEYS,
  SCENE_PARAM_LABEL,
  type SceneContent,
  sceneImportCores,
  type SceneImportGroup,
  type SceneImportMode,
  type SceneImportPlan,
  type SceneImportSource,
  slotRoom,
  sourceFromNovelaiMeta,
  type TagRef,
} from '@app/tagloom/share'
import { api, parseResponse } from '../api.ts'
import { usePageFileDrop } from './file-drop.ts'

// 词库批量核对一次最多 100 个
const LOOKUP_CHUNK = 100
const LOOKUP_HIT = new Set(['exact', 'alias', 'label'])

// 查不到或词库不可用时返回空表（全部做成文本条目），并给出原因
async function lookupTags(
  cores: string[],
): Promise<{ map: Map<string, TagRef>; problem: string | null }> {
  const map = new Map<string, TagRef>()
  try {
    for (let i = 0; i < cores.length; i += LOOKUP_CHUNK) {
      const res = await parseResponse(api.agent.catalog.lookup.$post({
        json: { tags: cores.slice(i, i + LOOKUP_CHUNK) },
      }))
      if (!res.verified) {
        return { map, problem: '词库不可用：全部做成文本条目。' }
      }
      for (const r of res.results) {
        if (LOOKUP_HIT.has(r.status) && 'tag' in r && r.tag) {
          map.set(r.input, {
            canonical: r.tag.canonical,
            labelZh: r.tag.labelZh,
            categoryPath: r.tag.categoryPath,
            catalogVersion: res.catalogVersion,
          })
        }
      }
    }
    return { map, problem: null }
  } catch {
    return { map, problem: '词库查询失败：全部做成文本条目。' }
  }
}

export interface PendingSceneImport {
  name: string
  // 图片缩略图；不是图片时 null
  url: string | null
  tags: { label: string; warning?: boolean }[]
  // 显示在缩略图旁的说明
  hints: string[]
  plan: SceneImportPlan
  problem: string | null
}

// 查词库并生成导入计划
export async function prepareSceneImport(src: SceneImportSource): Promise<{
  plan: SceneImportPlan
  problem: string | null
}> {
  const { map, problem } = await lookupTags(sceneImportCores(src))
  return { plan: planSceneImport(src, map), problem }
}

// 场景列表 → 新建的场景编辑页：只在页面内存里转交一张图片，刷新就没了
let stashed: File | null = null
export function stashSceneImage(file: File) {
  stashed = file
}

export function SceneImport(props: {
  draft: SceneContent
  onApply: (fn: (c: SceneContent) => SceneContent) => void
}) {
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingSceneImport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (pending?.url) URL.revokeObjectURL(pending.url)
    setPending(null)
  }

  const read = async (file: File | undefined) => {
    if (!file || busy) return
    setError(null)
    setBusy(true)
    try {
      const meta = parseNovelaiPng(new Uint8Array(await file.arrayBuffer()))
      if (!meta) {
        setError(`「${file.name}」里没有 NovelAI 信息。`)
        return
      }
      const { plan, problem } = await prepareSceneImport(
        sourceFromNovelaiMeta(meta),
      )
      if (pending?.url) URL.revokeObjectURL(pending.url)
      setPending({
        name: file.name,
        url: URL.createObjectURL(file),
        tags: [
          { label: '包含 NovelAI 信息' },
          ...(meta.img2img ? [{ label: '基于图生图', warning: true }] : []),
          ...(!meta.comment ? [{ label: '只有 Prompt', warning: true }] : []),
        ],
        hints: [
          ...(meta.source ? [`来源模型：${meta.source}`] : []),
          '模型只有描述，不导入；需要的话在「生成参数」里手填。',
        ],
        plan,
        problem,
      })
    } finally {
      setBusy(false)
    }
  }

  const over = usePageFileDrop(read, !busy && !pending)
  // 从场景列表拖图片新建过来的：接着导入
  useEffect(() => {
    const file = stashed
    stashed = null
    if (file) read(file)
  }, [])

  return (
    <>
      <label
        className={`button${busy ? ' is-loading' : ''}${
          over ? ' is-link is-light' : ''
        }`}
        htmlFor={inputId}
        title='导入 NovelAI 生成的图片里的 Prompt 和人物；也可以直接把图片拖到页面上'
      >
        {over ? '松开导入' : '从图片导入'}
      </label>
      <input
        id={inputId}
        className='is-sr-only'
        type='file'
        accept='image/png'
        disabled={busy}
        onChange={(e) => {
          read(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {error && (
        <span className='is-size-7 has-text-danger' role='alert'>{error}</span>
      )}
      {pending && (
        <SceneImportModal
          key={pending.url ?? pending.name}
          pending={pending}
          draft={props.draft}
          onCancel={close}
          onApply={(groups, mode) => {
            const { plan } = pending
            props.onApply((c) => applySceneImport(c, plan, groups, mode))
            close()
          }}
        />
      )}
    </>
  )
}

const COLS = 'ABCDE'
const cellOf = (p: { x: number; y: number }) =>
  `${COLS[Math.round((p.x - 0.1) / 0.2)]}${Math.round((p.y - 0.1) / 0.2) + 1}`

function Pieces({ list }: { list: ImportPiece[] }) {
  if (list.length === 0) return <span className='has-text-grey'>（空）</span>
  return (
    <span className='tags mb-0'>
      {list.map((p, i) => (
        <span
          key={i}
          className={`tag mb-1${p.tag ? ' is-success is-light' : ''}`}
          title={p.tag
            ? `词库：${p.tag.canonical}（${p.tag.labelZh}）`
            : '文本条目（词库里没有，或不是单个标签）'}
        >
          {p.tag && <span className='mr-1' aria-hidden='true'>✓</span>}
          {p.text}
          {p.tag && p.tag.labelZh !== p.tag.canonical && (
            <span className='has-text-grey ml-1'>{p.tag.labelZh}</span>
          )}
        </span>
      ))}
    </span>
  )
}

export function SceneImportModal(props: {
  pending: PendingSceneImport
  draft: SceneContent
  onCancel: () => void
  onApply: (groups: Set<SceneImportGroup>, mode: SceneImportMode) => void
}) {
  const { tags, hints, plan, url, name, problem } = props.pending
  const titleId = useId()
  const available: SceneImportGroup[] = [
    ...(plan.content.length ? ['content' as const] : []),
    ...(plan.characters.length ? ['characters' as const] : []),
    ...(plan.negative ? ['negative' as const] : []),
    ...(Object.keys(plan.params).length ? ['params' as const] : []),
  ]
  const [groups, setGroups] = useState(() => new Set(available))
  const [mode, setMode] = useState<SceneImportMode>('append')
  const room = Math.max(0, slotRoom(props.draft, mode))
  const dropped = Math.max(0, plan.characters.length - room)
  const hits = plan.content.filter((p) => p.tag).length
  const toggle = (g: SceneImportGroup, on: boolean) => {
    const next = new Set(groups)
    if (on) next.add(g)
    else next.delete(g)
    setGroups(next)
  }
  const group = (g: SceneImportGroup, label: string, body: ReactNode) =>
    available.includes(g) && (
      <div className='nai-import-group is-block'>
        <label className='checkbox'>
          <input
            type='checkbox'
            className='mr-2'
            checked={groups.has(g)}
            onChange={(e) => toggle(g, e.target.checked)}
          />
          <strong>{label}</strong>
        </label>
        <div className='mt-1 ml-5'>{body}</div>
      </div>
    )

  return (
    <div
      className='modal is-active'
      role='dialog'
      aria-modal='true'
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onCancel()
      }}
    >
      <div className='modal-background' onClick={props.onCancel} />
      <div className='modal-card'>
        <header className='modal-card-head'>
          <p className='modal-card-title' id={titleId}>导入「{name}」</p>
          <button
            type='button'
            className='delete'
            aria-label='关闭'
            onClick={props.onCancel}
          />
        </header>
        <section className='modal-card-body'>
          <div className='nai-import-head mb-3'>
            {url && <img src={url} alt='' className='nai-import-thumb' />}
            <div>
              <div className='tags mb-2'>
                {tags.map((t) => (
                  <span
                    key={t.label}
                    className={`tag is-light ${
                      t.warning ? 'is-warning' : 'is-info'
                    }`}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
              {hints.map((h) => (
                <p key={h} className='is-size-7 has-text-grey'>{h}</p>
              ))}
            </div>
          </div>

          {[problem, ...plan.notes].filter(Boolean).map((n) => (
            <p key={n} className='notification is-warning is-light py-2 px-3'>
              {n}
            </p>
          ))}

          <div className='field'>
            <p className='label mb-1'>导入方式</p>
            <div className='control'>
              <label className='radio mr-4'>
                <input
                  type='radio'
                  name={`${titleId}-mode`}
                  className='mr-1'
                  checked={mode === 'append'}
                  onChange={() => setMode('append')}
                />
                追加到现有内容后面
              </label>
              <label className='radio'>
                <input
                  type='radio'
                  name={`${titleId}-mode`}
                  className='mr-1'
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />
                替换
              </label>
            </div>
            <p className='help'>
              {mode === 'replace'
                ? '先清空场景内容、负面 Prompt 和人物（勾选了生成参数时也清空参数），再导入；标题、备注和场景标签库不变。'
                : '词库标签已经在场景里时只重新勾选，不重复添加；生成参数只覆盖导入内容里有的项。'}
              不点「保存」就不会写进文件。
            </p>
          </div>

          {group(
            'content',
            `场景内容：${plan.content.length} 条（${hits} 条在词库）`,
            <Pieces list={plan.content} />,
          )}
          {group(
            'characters',
            `人物：${plan.characters.length} 个`,
            <>
              {plan.characters.map((ch, i) => (
                <div
                  key={i}
                  className={`mb-2${i >= room ? ' has-text-grey-light' : ''}`}
                >
                  <span className='is-size-7 mr-2'>
                    人物 {i + 1} ·{' '}
                    {ch.position ? `位置 ${cellOf(ch.position)}` : '不指定位置'}
                  </span>
                  <Pieces list={ch.pieces} />
                </div>
              ))}
              {dropped > 0 && (
                <p className='help is-danger'>
                  场景最多 {MAX_SCENE_SLOTS} 个人物，后面 {dropped}{' '}
                  个放不下，不导入。
                </p>
              )}
            </>,
          )}
          {group(
            'negative',
            '负面 Prompt',
            <code className='tagloom-prompt is-size-7'>{plan.negative}</code>,
          )}
          {group(
            'params',
            '生成参数',
            <span className='tags mb-0'>
              {SCENE_PARAM_KEYS.filter((k) => plan.params[k] !== undefined)
                .map((k) => (
                  <span key={k} className='tag mb-1'>
                    {SCENE_PARAM_LABEL[k]}：{plan.params[k]}
                  </span>
                ))}
            </span>,
          )}
        </section>
        <footer className='modal-card-foot'>
          <div className='buttons'>
            <button
              type='button'
              className='button is-primary'
              disabled={groups.size === 0}
              onClick={() => props.onApply(groups, mode)}
            >
              导入
            </button>
            <button
              type='button'
              className='button'
              autoFocus
              onClick={props.onCancel}
            >
              取消
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
