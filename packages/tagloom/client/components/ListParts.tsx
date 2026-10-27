// 文件夹式列表（人物列表、场景列表）共用的小组件：行操作按钮、面包屑、搜索框、名称 / 路径输入对话框
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'wouter'
import { parentOf } from '@app/tagloom/share'
import type { ApiError } from '../api.ts'
import { ErrorNotice } from './common.tsx'

export function RowActions(
  props: { onMove: () => void; onDelete: () => void },
) {
  return (
    <div className='buttons are-small is-justify-content-flex-end is-flex-wrap-nowrap mb-0'>
      <button type='button' className='button mb-0' onClick={props.onMove}>
        移动 / 改名
      </button>
      <button
        type='button'
        className='button is-danger is-outlined mb-0'
        onClick={props.onDelete}
      >
        删除
      </button>
    </div>
  )
}

// 当前文件夹的面包屑：rootLabel 是根目录的名称，hrefOf 由文件夹得到站内地址
export function Breadcrumb(
  { folder, rootLabel, hrefOf }: {
    folder: string
    rootLabel: string
    hrefOf: (folder: string) => string
  },
) {
  const parts = folder ? folder.split('/') : []
  return (
    <nav className='breadcrumb mb-3' aria-label='当前文件夹'>
      <ul>
        <li className={folder ? '' : 'is-active'}>
          <Link
            href={hrefOf('')}
            aria-current={folder ? undefined : 'page'}
          >
            {rootLabel}
          </Link>
        </li>
        {parts.map((part, i) => {
          const last = i === parts.length - 1
          return (
            <li key={i} className={last ? 'is-active' : ''}>
              <Link
                href={hrefOf(parts.slice(0, i + 1).join('/'))}
                aria-current={last ? 'page' : undefined}
              >
                {part}
              </Link>
            </li>
          )
        })}
      </ul>
      {folder && (
        <Link href={hrefOf(parentOf(folder))} className='is-size-7'>
          返回上级文件夹
        </Link>
      )}
    </nav>
  )
}

export function SearchBox(
  props: {
    initial: string
    onSearch: (q: string) => void
    // 搜索框的说明文字
    label: string
  },
) {
  const [text, setText] = useState(props.initial)
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    props.onSearch(text.trim())
  }
  return (
    <form className='field has-addons mb-3' role='search' onSubmit={onSubmit}>
      <div className='control is-expanded'>
        <input
          className='input'
          type='search'
          aria-label={props.label}
          placeholder={props.label}
          value={text}
          onChange={(e) =>
            setText(e.target.value)}
        />
      </div>
      <div className='control'>
        <button type='submit' className='button'>搜索</button>
      </div>
    </form>
  )
}

// 输入一个名称或路径的对话框（新建文件夹、移动 / 改名）
export function NameModal(props: {
  open: boolean
  title: string
  label: string
  help?: string
  initial: string
  busy: boolean
  error: ApiError | null
  check: (value: string) => string | null
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const id = useId()
  const [value, setValue] = useState(props.initial)
  const [touched, setTouched] = useState(false)
  const onCancel = useRef(props.onCancel)
  onCancel.current = props.onCancel
  useEffect(() => {
    if (!props.open) return
    setValue(props.initial)
    setTouched(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel.current()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [props.open, props.initial])
  if (!props.open) return null
  const problem = props.check(value)
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!problem && value.trim() !== props.initial) {
      props.onSubmit(value.trim())
    }
  }
  return (
    <div
      className='modal is-active'
      role='dialog'
      aria-modal='true'
      aria-labelledby={`${id}-title`}
    >
      <div className='modal-background' onClick={props.onCancel} />
      <form className='modal-card' onSubmit={onSubmit}>
        <header className='modal-card-head'>
          <p className='modal-card-title' id={`${id}-title`}>{props.title}</p>
          <button
            type='button'
            className='delete'
            aria-label='关闭'
            onClick={props.onCancel}
          />
        </header>
        <section className='modal-card-body'>
          <label className='label' htmlFor={`${id}-input`}>{props.label}</label>
          <input
            id={`${id}-input`}
            className={`input${touched && problem ? ' is-danger' : ''}`}
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
          {touched && problem && <p className='help is-danger'>{problem}</p>}
          {props.help && <p className='help'>{props.help}</p>}
          <ErrorNotice error={props.error} />
        </section>
        <footer className='modal-card-foot'>
          <div className='buttons'>
            <button
              type='submit'
              className={`button is-primary${props.busy ? ' is-loading' : ''}`}
              disabled={props.busy}
            >
              确定
            </button>
            <button type='button' className='button' onClick={props.onCancel}>
              取消
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}
