// 场景的添加输入框（场景不分类）：输入时在下拉里列出场景自创标签和全词库搜索结果，
// 点选（或 ↑ ↓ + Enter）作为勾选的条目加入；不选时按「添加」（或 Enter）把输入原样作为文本条目加入，
// 按「存为自创标签」则先加进场景标签库再作为条目加入。条目都不记字段（field = null）。
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  addTextItem,
  type CatalogHit,
  type CustomTag,
  type CustomTagInput,
  ORIGIN_LABEL,
  pickCatalogTag,
  pickCustomTag,
  type Segment,
  tagRefOf,
} from '@app/tagloom/share'
import { api, apiErrorOf, keys, parseResponse } from '../api.ts'
import { ErrorNotice, NoteMatch, UnverifiedTag } from './common.tsx'

const CUSTOM_LIMIT = 8
const CATALOG_LIMIT = 20

type Option =
  | { kind: 'custom'; tag: CustomTag }
  | { kind: 'catalog'; tag: CatalogHit }

const GROUP_LABEL: Record<Option['kind'], string> = {
  custom: '场景自创标签',
  catalog: '词库（全部分类）',
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function SceneTagInput(props: {
  // 加到哪里，如「场景内容」「主角 · 补充」
  label: string
  segment: Segment
  customTags: CustomTag[]
  onChange: (fn: (seg: Segment) => Segment) => void
  // 把新标签加入场景标签库（人工创建），返回创建好的标签
  onCreateCustomTag: (input: CustomTagInput) => CustomTag
}) {
  const { segment, onChange } = props
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  // -1：没有选中建议，Enter 添加文本条目
  const [active, setActive] = useState(-1)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const dq = useDebounced(text.trim(), 200)

  const results = useQuery({
    queryKey: keys.catalogSearch(dq, CATALOG_LIMIT),
    queryFn: () =>
      parseResponse(
        api.catalog.search.$get({
          query: { q: dq, limit: String(CATALOG_LIMIT) },
        }),
      ),
    enabled: dq.length > 0,
    staleTime: 60_000,
  })
  const data = results.data
  const version = data?.verified ? data.catalogVersion : null

  const needle = dq.toLowerCase()
  const options: Option[] = [
    ...(needle
      ? props.customTags.filter((t) =>
        t.text.toLowerCase().includes(needle) ||
        t.label.toLowerCase().includes(needle)
      ).slice(0, CUSTOM_LIMIT)
      : []).map((tag) => ({ kind: 'custom' as const, tag })),
    ...(data?.verified ? data.items : []).map((tag) => ({
      kind: 'catalog' as const,
      tag,
    })),
  ]

  useEffect(() => setActive(-1), [dq])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const included = (o: Option) =>
    segment.items.some((i) =>
      i.included &&
      (o.kind === 'custom'
        ? i.source.kind === 'custom' && i.source.customId === o.tag.id
        : i.source.kind === 'catalog' &&
          i.source.tag.canonical === o.tag.canonical)
    )

  const reset = () => {
    setText('')
    setActive(-1)
    setOpen(false)
    input.current?.focus()
  }

  const pick = (o: Option) => {
    if (included(o)) return
    if (o.kind === 'custom') {
      onChange((s) => pickCustomTag(s, null, o.tag))
    } else {
      onChange((s) => pickCatalogTag(s, null, tagRefOf(o.tag, version)))
    }
    reset()
  }

  const addText = () => {
    if (!text.trim()) return
    onChange((s) => addTextItem(s, text))
    reset()
  }

  const addAsCustom = () => {
    if (!text.trim()) return
    const tag = props.onCreateCustomTag({ text })
    onChange((s) => pickCustomTag(s, null, tag))
    reset()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const o = open ? options[active] : undefined
    if (o) pick(o)
    else addText()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) setOpen(false)
      else setText('')
      return
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length) {
      e.preventDefault()
      setOpen(true)
      const n = options.length
      // 在「不选（-1）」和各个建议之间循环
      setActive((cur) =>
        e.key === 'ArrowDown'
          ? (cur + 2) % (n + 1) - 1
          : (cur + n + 1) % (n + 1) - 1
      )
    }
  }

  const showPanel = open && dq.length > 0
  const optionId = (i: number) => `${listId}-${i}`

  return (
    <div className='tagloom-add-suggest' ref={root}>
      <form className='field has-addons mt-2 mb-0' onSubmit={onSubmit}>
        <div className='control is-expanded'>
          <input
            ref={input}
            className='input is-small'
            placeholder='搜索词库标签（中文 / 英文 / 别名）或场景自创标签；不选时直接添加文本（可含权重）'
            aria-label={`给「${props.label}」添加标签或文本条目`}
            role='combobox'
            aria-autocomplete='list'
            aria-expanded={showPanel}
            aria-controls={listId}
            aria-activedescendant={showPanel && active >= 0
              ? optionId(active)
              : undefined}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className='control'>
          <button
            type='submit'
            className='button is-small'
            disabled={!text.trim()}
          >
            ＋ 添加
          </button>
        </div>
        <div className='control'>
          <button
            type='button'
            className='button is-small'
            disabled={!text.trim()}
            title='把输入的文本存进场景标签库，并作为条目加入'
            onClick={addAsCustom}
          >
            存为自创标签
          </button>
        </div>
      </form>
      {showPanel && (
        <div className='tagloom-add-suggest-panel box p-2'>
          <ul id={listId} role='listbox' aria-label='可添加的标签'>
            {options.map((o, i) => {
              const head = i === 0 || options[i - 1].kind !== o.kind
              const done = included(o)
              return (
                <li
                  key={`${o.kind}:${
                    o.kind === 'custom' ? o.tag.id : o.tag.canonical
                  }`}
                >
                  {head && (
                    <p
                      className='is-size-7 has-text-grey mt-1 mb-1'
                      role='presentation'
                    >
                      {GROUP_LABEL[o.kind]}
                    </p>
                  )}
                  <div
                    id={optionId(i)}
                    role='option'
                    aria-selected={i === active}
                    aria-disabled={done}
                    className={`tagloom-add-suggest-option${
                      i === active ? ' is-active' : ''
                    }${done ? ' is-done' : ''}`}
                    // 不让输入框失去焦点，点完可以接着输入
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                  >
                    <OptionText option={o} />
                    {done && (
                      <span className='tag is-success is-light ml-2'>
                        ✓ 已添加
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {results.error
            ? <ErrorNotice error={apiErrorOf(results.error)} />
            : data && !data.verified
            ? (
              <p className='is-size-7 mt-1'>
                <UnverifiedTag /> {data.reason}
              </p>
            )
            : results.isPending
            ? <p className='is-size-7 has-text-grey mt-1'>搜索中…</p>
            : options.length === 0 && (
              <p className='is-size-7 has-text-grey mt-1'>
                没有找到匹配的标签。
              </p>
            )}
          <p className='is-size-7 has-text-grey mt-2'>
            ↑ ↓ 选择，Enter 添加选中的标签；不选时 Enter / 「添加」把「{text
              .trim()}」作为文本条目加入。Esc 收起。
          </p>
        </div>
      )}
    </div>
  )
}

function OptionText({ option }: { option: Option }) {
  if (option.kind === 'custom') {
    const t = option.tag
    return (
      <span>
        <span aria-hidden='true' className='mr-1'>
          {t.origin === 'agent' ? '🤖' : '👤'}
        </span>
        <span className='has-text-weight-semibold'>{t.label || t.text}</span>
        {t.label && <span className='has-text-grey ml-1'>{t.text}</span>}
        <span className='is-sr-only'>（{ORIGIN_LABEL[t.origin]}创建）</span>
      </span>
    )
  }
  const t = option.tag
  return (
    <span>
      <span className='has-text-weight-semibold'>
        {t.labelZh || t.canonical}
      </span>
      <span className='has-text-grey ml-1'>{t.canonical}</span>
      <span className='has-text-grey is-size-7 ml-2'>
        {t.categoryLabelZh || t.categoryPath || '未分类'} · 频次{' '}
        {t.postCount.toLocaleString()}
      </span>
      <NoteMatch tag={t} />
    </span>
  )
}
