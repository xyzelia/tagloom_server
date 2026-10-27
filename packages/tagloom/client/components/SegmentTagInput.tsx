// 分类里的添加输入框：输入时在下拉里列出可选的标签——本角色的自创标签、本分类对应词库分类里的标签、
// 其他分类里搜到的标签。点选（或 ↑ ↓ + Enter）直接作为勾选的条目加进本分类；
// 不选时按「添加」（或 Enter）把输入原样作为文本条目加入。
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  addTextItem,
  type CatalogTag,
  type CustomTag,
  ORIGIN_LABEL,
  pickCatalogTag,
  pickCustomTag,
  type Segment,
  segmentCategoryPaths,
  type SegmentDef,
  segmentFieldFor,
  tagRefOf,
} from '@app/tagloom/share'
import { api, apiErrorOf, keys, parseResponse } from '../api.ts'
import { ErrorNotice, NoteMatch, UnverifiedTag } from './common.tsx'

const CUSTOM_LIMIT = 8

type Option =
  | { kind: 'custom'; tag: CustomTag }
  | { kind: 'section' | 'other'; tag: CatalogTag }

const GROUP_LABEL: Record<Option['kind'], string> = {
  custom: '本角色自创标签',
  section: '本分类词库',
  other: '其他分类（也可加到这里）',
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// 自创标签：适用于本分类任一字段（或不限字段），文本或说明包含输入（不分大小写）
export function matchCustomTags(
  tags: CustomTag[],
  def: SegmentDef,
  q: string,
): CustomTag[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  const fields = new Set(def.fields.map((f) => f.key))
  return tags.filter((t) =>
    (t.fields.length === 0 || t.fields.some((f) => fields.has(f))) &&
    (t.text.toLowerCase().includes(needle) ||
      t.label.toLowerCase().includes(needle))
  ).slice(0, CUSTOM_LIMIT)
}

export function SegmentTagInput(props: {
  def: SegmentDef
  segment: Segment
  customTags: CustomTag[]
  onChange: (fn: (seg: Segment) => Segment) => void
}) {
  const { def, segment, onChange } = props
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  // -1：没有选中建议，Enter 添加文本条目
  const [active, setActive] = useState(-1)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const dq = useDebounced(text.trim(), 200)
  const paths = useMemo(() => segmentCategoryPaths(def).join(','), [def])

  const results = useQuery({
    queryKey: keys.segmentSearch(paths, dq),
    queryFn: () =>
      parseResponse(
        api.catalog['segment-search'].$get({ query: { q: dq, paths } }),
      ),
    enabled: dq.length > 0,
    staleTime: 60_000,
  })
  const data = results.data
  const version = data?.verified ? data.catalogVersion : null

  const options: Option[] = [
    ...matchCustomTags(props.customTags, def, dq).map((tag) => ({
      kind: 'custom' as const,
      tag,
    })),
    ...(data?.verified
      ? [
        ...data.items.map((tag) => ({ kind: 'section' as const, tag })),
        ...data.others.map((tag) => ({ kind: 'other' as const, tag })),
      ]
      : []),
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
      const fields = new Set(def.fields.map((f) => f.key))
      const field = o.tag.fields.find((f) => fields.has(f)) ?? null
      onChange((s) => pickCustomTag(s, field, o.tag))
    } else {
      const field = segmentFieldFor(def, o.tag.categoryPath)
      onChange((s) => pickCatalogTag(s, field, tagRefOf(o.tag, version)))
    }
    reset()
  }

  const addText = () => {
    if (!text.trim()) return
    onChange((s) => addTextItem(s, text))
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
            placeholder='输入标签：从下拉选词库 / 自创标签，或直接添加文本（原样保留，可含权重，如 (messy hair:0.8)）'
            aria-label={`给「${def.label}」添加标签或文本条目`}
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
                    'id' in o.tag ? o.tag.id : o.tag.canonical
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
        {t.categoryLabelZh || t.categoryPath} · 频次{' '}
        {t.postCount.toLocaleString()}
      </span>
      <NoteMatch tag={t} />
    </span>
  )
}
