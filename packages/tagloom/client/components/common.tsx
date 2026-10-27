// 小组件：页面标题、确认弹窗、错误提示、状态标签、复制按钮。
// 状态一律「颜色 + 文字（+ 符号）」表示，不只靠颜色区分。
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import type { Decision, MatchKind } from '@app/tagloom/share'
import { MATCH_LABEL } from '@app/tagloom/share'
import { type ApiError, errorText } from '../api.ts'

export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · TagLoom`
  }, [title])
}

// 编辑页顶部操作栏高度会随窄屏换行、全局搜索变化：写到 CSS 变量 --tagloom-bar-h，
// 右侧预览的吸顶位置和目录跳转的滚动位置都按它让开，不被操作栏挡住。返回值作为操作栏的 ref。
export function useBarHeight() {
  const [bar, setBar] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!bar) return
    const root = document.documentElement
    const sync = () =>
      root.style.setProperty('--tagloom-bar-h', `${bar.offsetHeight}px`)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--tagloom-bar-h')
    }
  }, [bar])
  return setBar
}

export function Loading() {
  return (
    <progress className='progress is-small is-primary' aria-label='加载中' />
  )
}

export function ErrorNotice(
  props: {
    error: ApiError | null
    onClose?: () => void
    action?: ReactNode
    // 提示里的叫法，默认「人物」
    noun?: string
  },
) {
  if (!props.error) return null
  return (
    <div className='notification is-danger is-light' role='alert'>
      {props.onClose && (
        <button
          type='button'
          className='delete'
          aria-label='关闭提示'
          onClick={props.onClose}
        />
      )}
      <p>{errorText(props.error, props.noun)}</p>
      {props.action && <div className='mt-2'>{props.action}</div>}
    </div>
  )
}

export function ConfirmModal(props: {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const onCancel = useRef(props.onCancel)
  onCancel.current = props.onCancel
  useEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel.current()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [props.open])
  if (!props.open) return null
  return (
    <div
      className='modal is-active'
      role='dialog'
      aria-modal='true'
      aria-labelledby={titleId}
    >
      <div className='modal-background' onClick={props.onCancel} />
      <div className='modal-card'>
        <header className='modal-card-head'>
          <p className='modal-card-title' id={titleId}>{props.title}</p>
          <button
            type='button'
            className='delete'
            aria-label='关闭'
            onClick={props.onCancel}
          />
        </header>
        {props.children && (
          <section className='modal-card-body'>{props.children}</section>
        )}
        <footer className='modal-card-foot'>
          <div className='buttons'>
            <button
              type='button'
              className={`button is-danger${props.busy ? ' is-loading' : ''}`}
              disabled={props.busy}
              onClick={props.onConfirm}
            >
              {props.confirmLabel ?? '确认'}
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

const MATCH_CLASS: Record<MatchKind, string> = {
  canonical: 'is-success',
  alias: 'is-info',
  label: 'is-link',
  partial: 'is-warning',
  none: 'is-danger is-light',
  manual: 'is-light',
}
const MATCH_ICON: Record<MatchKind, string> = {
  canonical: '✓',
  alias: '≈',
  label: '文',
  partial: '~',
  none: '✗',
  manual: '✋',
}

export function MatchTag({ match }: { match: MatchKind }) {
  return (
    <span className={`tag ${MATCH_CLASS[match]}`}>
      <span aria-hidden='true' className='mr-1'>{MATCH_ICON[match]}</span>
      {MATCH_LABEL[match]}
    </span>
  )
}

const DECISION: Record<Decision, [string, string]> = {
  pending: ['is-warning is-light', '? 待确认'],
  confirmed: ['is-success is-light', '✓ 已确认'],
  rejected: ['is-dark is-light', '✗ 已拒绝'],
}

export function DecisionTag({ decision }: { decision: Decision }) {
  const [cls, label] = DECISION[decision]
  return <span className={`tag ${cls}`}>{label}</span>
}

// 只靠说明命中的检索结果：显示说明，加粗找到的检索词
export function NoteMatch(
  { tag }: { tag: { notes: string; evidence?: string; byNote?: true } },
) {
  if (!tag.byNote || !tag.notes) return null
  const words = (tag.evidence ?? '').split(' ').filter(Boolean)
  const parts = words.length
    ? tag.notes.split(
      new RegExp(
        `(${
          words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(
            '|',
          )
        })`,
        'giu',
      ),
    )
    : [tag.notes]
  return (
    <span className='is-block is-size-7 has-text-grey'>
      说明：{parts.map((p, i) =>
        i % 2 ? <strong key={i} className='has-text-grey-dark'>{p}</strong> : p
      )}
    </span>
  )
}

export function UnverifiedTag() {
  return <span className='tag is-warning is-light'>⚠ 未进行数据库核查</span>
}

export function CopyButton(
  { text, label = '复制' }: { text: string; label?: string },
) {
  const [done, setDone] = useState(false)
  return (
    <button
      type='button'
      className='button is-small'
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          // 非安全上下文（内网 http）没有剪贴板 API：退回到选中文本让用户手动复制
          globalThis.prompt?.('复制以下内容', text)
        }
      }}
    >
      {done ? '已复制' : label}
    </button>
  )
}

// 「启用」开关：是否输出到最终 Prompt（条目、场景快照各段共用）。
// 睁眼 = 启用，闭眼带斜线 = 停用；不只靠颜色区分。和「选中」（批量操作用的选择框）是两回事。
export function EnableToggle(
  props: { on: boolean; label: string; onChange: (on: boolean) => void },
) {
  return (
    <button
      type='button'
      className={`button tagloom-enable${props.on ? ' is-on' : ''}`}
      aria-pressed={props.on}
      aria-label={`输出「${props.label}」`}
      title={props.on
        ? '已启用：输出到最终 Prompt（点击停用）'
        : '已停用：不输出（点击启用）'}
      onClick={() => props.onChange(!props.on)}
    >
      <svg
        viewBox='0 0 24 24'
        width='1.15em'
        height='1.15em'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
      >
        <path d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' />
        <circle cx='12' cy='12' r='3' />
        {!props.on && <line x1='3' y1='3' x2='21' y2='21' />}
      </svg>
    </button>
  )
}

// 一段可复制的 Prompt 预览
export function PreviewBlock(
  props: { label: string; text: string; strong?: boolean },
) {
  return (
    <div className='mb-3'>
      <div className='is-flex is-justify-content-space-between is-align-items-center mb-1'>
        <span
          className={`is-size-7 ${
            props.strong ? 'has-text-weight-bold' : 'has-text-grey'
          }`}
        >
          {props.label}
        </span>
        <CopyButton text={props.text} />
      </div>
      <pre className='is-size-7 p-2 tagloom-prompt'>{props.text || '（空）'}</pre>
    </div>
  )
}

// 时间都是 epoch 毫秒，只在这里按浏览器本地时区显示
export const formatTime = (
  ms: number | null | undefined,
) => (ms ? new Date(ms).toLocaleString() : '-')

// 未保存修改的离开提醒（做法同 novelai 插件的 useUnsavedGuard；插件之间不能互相 import 前端代码）。
// 关闭 / 刷新页面用浏览器自带提示；点站内链接（顶部导航、「← 人物列表」等）弹确认框。
// 返回值是确认框，调用方渲染在页面里。浏览器后退按钮无法拦截，不在保护范围内。
export function useUnsavedGuard(dirty: boolean, noun = '人物'): ReactNode {
  const [, navigate] = useLocation()
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    // 捕获阶段拦截，早于 wouter 的 Link 处理点击
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]')
      if (!(a instanceof HTMLAnchorElement)) return
      if (a.target === '_blank' || a.hasAttribute('download')) return
      // 组合标签页等用 href='#' 的页内操作不拦截
      if (a.getAttribute('href') === '#') return
      const url = new URL(a.href)
      if (url.origin !== location.origin) return
      const to = url.pathname + url.search
      if (to === location.pathname + location.search) return
      // 导出等接口链接不是页面跳转
      if (url.pathname.startsWith('/api/')) return
      e.preventDefault()
      e.stopPropagation()
      setPending(to)
    }
    globalThis.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      globalThis.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])

  return (
    <ConfirmModal
      open={pending !== null}
      title='放弃未保存的修改？'
      confirmLabel='放弃并离开'
      onConfirm={() => {
        const to = pending
        setPending(null)
        // ~ 开头：相对站点根路径跳转（当前在插件的嵌套路由 /tagloom 里）
        if (to) navigate(`~${to}`)
      }}
      onCancel={() => setPending(null)}
    >
      当前{noun}有修改还没有保存，离开后这些修改会丢失。
    </ConfirmModal>
  )
}

// 底部弹出面板（窄屏用）：Esc / 点遮罩 / 关闭按钮关闭，打开时锁住背景滚动，关闭后焦点回到打开按钮
export function BottomSheet(
  props: {
    title: string
    open: boolean
    onClose: () => void
    children: ReactNode
  },
) {
  const { open, onClose } = props
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const html = document.documentElement
    html.classList.add('is-clipped')
    closeButton.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => {
      globalThis.removeEventListener('keydown', onKey)
      html.classList.remove('is-clipped')
      opener?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className='modal is-active tagloom-sheet'
      role='dialog'
      aria-modal='true'
      aria-label={props.title}
    >
      <div className='modal-background' onClick={onClose} />
      <div className='tagloom-sheet-panel'>
        <div className='is-flex is-justify-content-space-between is-align-items-center mb-2'>
          <p className='title is-6 mb-0'>{props.title}</p>
          <button
            type='button'
            className='button is-small'
            ref={closeButton}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}
