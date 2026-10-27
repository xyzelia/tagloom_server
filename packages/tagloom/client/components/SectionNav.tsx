// 编辑页目录：放在顶部操作栏，列出各分类并标出是否有内容；点一项展开该分类并滚动过去。
// 电脑和手机共用同一个下拉，不额外占页面空间。
import { useEffect, useRef, useState } from 'react'
import { revealSection } from './Section.tsx'

export interface SectionNavItem {
  anchor: string
  label: string
  // 分组标题（Base / 造型组合等）没有内容标记
  hasContent?: boolean
  // 分组下的子项缩进
  nested?: boolean
}

export function SectionNav({ items }: { items: SectionNavItem[] }) {
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
      className={`dropdown tagloom-section-nav${open ? ' is-active' : ''}`}
    >
      <div className='dropdown-trigger'>
        <button
          type='button'
          className='button'
          aria-haspopup='true'
          aria-expanded={open}
          aria-controls='tagloom-section-nav-menu'
          onClick={() => setOpen(!open)}
        >
          目录 ▾
        </button>
      </div>
      <div className='dropdown-menu' id='tagloom-section-nav-menu'>
        <nav className='dropdown-content' aria-label='分类目录'>
          {items.map((item) => (
            <a
              key={item.anchor}
              href={`#${item.anchor}`}
              className={`dropdown-item${item.nested ? ' is-nested' : ''}${
                item.hasContent === undefined ? ' has-text-weight-semibold' : ''
              }`}
              onClick={(e) => {
                e.preventDefault()
                setOpen(false)
                revealSection(item.anchor)
              }}
            >
              <span>{item.label}</span>
              {item.hasContent !== undefined && (
                <span
                  className={`tag is-small ${
                    item.hasContent ? 'is-info is-light' : 'is-white'
                  }`}
                >
                  {item.hasContent ? '有内容' : '未填写'}
                </span>
              )}
            </a>
          ))}
        </nav>
      </div>
    </div>
  )
}
