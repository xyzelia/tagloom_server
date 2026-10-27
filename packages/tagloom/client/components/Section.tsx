import { type ReactNode, useEffect, useId, useState } from 'react'

// 目录跳转：展开带这个锚点的分类，再滚动过去（顶部操作栏的高度由 CSS scroll-margin 让开）
const REVEAL_EVENT = 'tagloom:reveal-section'

export function revealSection(anchor: string) {
  globalThis.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: anchor }))
  // 等 React 渲染完展开后的内容再滚动（setTimeout 而不是 rAF：后台标签页里 rAF 不执行）
  setTimeout(() => {
    const el = document.getElementById(anchor)
    if (!el) return
    el.scrollIntoView({ block: 'start' })
    // 把焦点放到分类标题上，键盘和读屏用户能从这里继续
    const target = el.matches('h1, h2, h3, h4')
      ? el
      : el.querySelector<HTMLElement>('.tagloom-section-toggle')
    target?.focus({ preventScroll: true })
  })
}

export function ContentBadge({ filled }: { filled: boolean }) {
  return (
    <span
      className={`tag tagloom-content-badge ${
        filled ? 'has-content' : 'is-empty'
      }`}
    >
      {filled && <span aria-hidden='true' className='mr-1'>✓</span>}
      {filled ? '有内容' : '未填写'}
    </span>
  )
}

export function Section(props: {
  title: string
  hasContent: boolean
  defaultOpen?: boolean
  // 标题行里始终可见的摘要（折叠时也显示）
  summary?: ReactNode
  // 目录里能跳到的分类需要锚点（页面内唯一）
  anchor?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true)
  const panelId = useId()
  const { anchor } = props
  useEffect(() => {
    if (!anchor) return
    const onReveal = (e: Event) => {
      if ((e as CustomEvent<string>).detail === anchor) setOpen(true)
    }
    globalThis.addEventListener(REVEAL_EVENT, onReveal)
    return () => globalThis.removeEventListener(REVEAL_EVENT, onReveal)
  }, [anchor])
  return (
    <div
      id={anchor}
      className={`card mb-3 tagloom-section ${
        props.hasContent ? 'has-content' : 'is-empty'
      }`}
    >
      <header className='card-header'>
        <button
          type='button'
          className='card-header-title button is-fullwidth tagloom-section-toggle'
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden='true' className='mr-2'>{open ? '▾' : '▸'}</span>
          <span className='tagloom-section-title'>{props.title}</span>
          <ContentBadge filled={props.hasContent} />
          {props.summary !== undefined && (
            <span className='tagloom-section-summary is-size-7'>
              {props.summary}
            </span>
          )}
        </button>
      </header>
      <div id={panelId} hidden={!open}>
        {open && <div className='card-content p-4'>{props.children}</div>}
      </div>
    </div>
  )
}
