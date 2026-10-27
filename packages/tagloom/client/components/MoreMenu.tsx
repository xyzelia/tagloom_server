// 列表页头部的「更多 ▾」：放不常用的操作（导入、文件浏览等），头部只留主要按钮。
// 点菜单项或菜单外、按 Esc 关闭。菜单项用 MoreMenuItem（链接或按钮）。
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'

export function MoreMenu(
  props: { children: (close: () => void) => ReactNode; over?: boolean },
) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    globalThis.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      globalThis.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      ref={root}
      className={`dropdown is-right${open ? ' is-active' : ''}`}
    >
      <div className='dropdown-trigger'>
        <button
          type='button'
          className={`button${props.over ? ' is-link is-light' : ''}`}
          aria-haspopup='true'
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {props.over ? '松开导入' : '更多 ▾'}
        </button>
      </div>
      <div className='dropdown-menu' role='menu'>
        <div className='dropdown-content'>
          {props.children(() => setOpen(false))}
        </div>
      </div>
    </div>
  )
}

export function MoreMenuItem(
  props: {
    children: ReactNode
    onSelect: () => void
    href?: string
    loading?: boolean
  },
) {
  if (props.href) {
    return (
      <Link
        className='dropdown-item'
        href={props.href}
        onClick={props.onSelect}
      >
        {props.children}
      </Link>
    )
  }
  return (
    <button
      type='button'
      className={`dropdown-item button is-white is-fullwidth is-justify-content-flex-start${
        props.loading ? ' is-loading' : ''
      }`}
      onClick={props.onSelect}
    >
      {props.children}
    </button>
  )
}
