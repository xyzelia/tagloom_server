// 全局标签搜索：在整个词库里搜（中文 / 英文 / 别名），点「加到 …」把标签作为勾选的条目加进对应分类。
// 目标分类按词库分类自动建议（suggestTagTargets），也可以从下拉里改成任意分类；
// 没有建议的标签（物品、场景等）只能手动选。组合 / 状态分类加到当前选中的组合 / 状态。
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  type CatalogHit,
  type Segment,
  suggestTagTargets,
  TAG_TARGETS,
  type TagTarget,
  tagTarget,
} from '@app/tagloom/share'
import { api, apiErrorOf, keys, parseResponse } from '../api.ts'
import { ErrorNotice, NoteMatch, UnverifiedTag } from './common.tsx'

const RESULT_LIMIT = 30

// 目标分类的当前分段；不能添加时返回原因（例如还没有组合 / 没选状态）
export type ResolveTarget = (target: TagTarget) => Segment | string

export function isTagIn(segment: Segment, canonical: string): boolean {
  return segment.items.some((i) =>
    i.included && i.source.kind === 'catalog' &&
    i.source.tag.canonical === canonical
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const GROUPS: { label: string; scope: TagTarget['scope'] }[] = [
  { label: 'Base（共享）', scope: 'base' },
  { label: '当前组合', scope: 'costume' },
  { label: '当前状态', scope: 'state' },
]

export function GlobalTagSearch(props: {
  resolve: ResolveTarget
  onAdd: (target: TagTarget, tag: CatalogHit, catalogVersion: string) => void
}) {
  const { resolve, onAdd } = props
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [added, setAdded] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const dq = useDebounced(q.trim(), 250)

  const results = useQuery({
    queryKey: keys.catalogSearch(dq, RESULT_LIMIT),
    queryFn: () =>
      parseResponse(
        api.catalog.search.$get({
          query: { q: dq, limit: String(RESULT_LIMIT) },
        }),
      ),
    enabled: dq.length > 0,
    staleTime: 60_000,
  })
  const items = results.data?.verified ? results.data.items : []
  const version = results.data?.catalogVersion ?? null

  useEffect(() => setActive(0), [dq])

  // 点到搜索框和结果以外的地方时收起
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const add = (target: TagTarget, hit: CatalogHit) => {
    if (!version || typeof resolve(target) === 'string') return
    onAdd(target, hit, version)
    setAdded(`已添加「${hit.labelZh || hit.canonical}」→ ${target.label}`)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open && q) setOpen(false)
      else setQ('')
      return
    }
    if (!items.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((active + step + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = items[active]
      const target = hit && suggestTagTargets(hit.categoryPath)[0]
      if (hit && target) add(target, hit)
    }
  }

  const showPanel = open && dq.length > 0

  return (
    <div className='tagloom-global-search' ref={root}>
      <div className='control has-icons-left'>
        <input
          className='input'
          type='search'
          placeholder='全局搜索词库标签（中文 / 英文 / 别名），选择后加到对应分类'
          aria-label='全局搜索词库标签'
          aria-expanded={showPanel}
          aria-controls='tagloom-global-search-results'
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
            setAdded(null)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <span className='icon is-left' aria-hidden='true'>⌕</span>
      </div>
      {showPanel && (
        <div
          id='tagloom-global-search-results'
          className='tagloom-global-search-panel box p-2'
        >
          {added && (
            <p className='is-size-7 has-text-success mb-2' role='status'>
              ✓ {added}
            </p>
          )}
          {results.error
            ? <ErrorNotice error={apiErrorOf(results.error)} />
            : results.data && !results.data.verified
            ? (
              <p className='is-size-7'>
                <UnverifiedTag /> {results.data.reason}
              </p>
            )
            : results.isPending
            ? <p className='is-size-7 has-text-grey'>搜索中…</p>
            : items.length === 0
            ? (
              <p className='is-size-7 has-text-grey'>
                词库里没有找到；可以在分类的选词区新建自创标签。
              </p>
            )
            : (
              <ul>
                {items.map((hit, i) => (
                  <ResultRow
                    key={hit.canonical}
                    hit={hit}
                    active={i === active}
                    resolve={resolve}
                    onAdd={(target) => add(target, hit)}
                  />
                ))}
              </ul>
            )}
          <p className='is-size-7 has-text-grey mt-2'>
            ↑ ↓ 选择，Enter 加到建议分类，Esc 收起。组合 /
            状态分类加到当前选中的组合 / 状态。
          </p>
        </div>
      )}
    </div>
  )
}

function ResultRow(props: {
  hit: CatalogHit
  active: boolean
  resolve: ResolveTarget
  onAdd: (target: TagTarget) => void
}) {
  const { hit, resolve } = props
  const row = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (props.active) row.current?.scrollIntoView({ block: 'nearest' })
  }, [props.active])
  const suggested = suggestTagTargets(hit.categoryPath)
  const primary = suggested[0]
  const state = (t: TagTarget) => {
    const r = resolve(t)
    return typeof r === 'string'
      ? { disabled: r, inside: false }
      : { disabled: null, inside: isTagIn(r, hit.canonical) }
  }
  const primaryState = primary && state(primary)
  const option = (t: TagTarget) => {
    const s = state(t)
    return (
      <option key={t.key} value={t.key} disabled={!!s.disabled || s.inside}>
        {t.label}
        {s.inside ? '（已添加）' : s.disabled ? `（${s.disabled}）` : ''}
      </option>
    )
  }

  return (
    <li
      ref={row}
      className={`tagloom-global-search-row${props.active ? ' is-active' : ''}`}
    >
      <div className='tagloom-global-search-tag'>
        <span className='has-text-weight-semibold'>
          {hit.labelZh || hit.canonical}
        </span>{' '}
        <span className='has-text-grey is-size-7'>{hit.canonical}</span>
        <p
          className='is-size-7 has-text-grey'
          title={[
            hit.aliases.length ? `别名／译名：${hit.aliases.join('、')}` : '',
            hit.notes && `说明：${hit.notes}`,
          ].filter(Boolean).join('\n') || undefined}
        >
          {hit.categoryLabelZh || hit.categoryPath || '未分类'} · 频次{' '}
          {hit.postCount.toLocaleString()}
        </p>
        <NoteMatch tag={hit} />
      </div>
      <div className='buttons are-small mb-0 tagloom-global-search-actions'>
        {primary && (
          primaryState.inside
            ? (
              <span className='tag is-success is-light'>
                ✓ 已在 {primary.label}
              </span>
            )
            : (
              <>
                {primaryState.disabled && (
                  <span className='is-size-7 has-text-grey'>
                    {primaryState.disabled}
                  </span>
                )}
                <button
                  type='button'
                  className='button is-primary is-light mb-0'
                  disabled={!!primaryState.disabled}
                  onClick={() => props.onAdd(primary)}
                >
                  加到 {primary.label}
                </button>
              </>
            )
        )}
        <div className='select is-small mb-0'>
          <select
            aria-label={`把 ${hit.canonical} 加到其他分类`}
            value=''
            onChange={(e) => {
              const t = tagTarget(e.target.value)
              if (t) props.onAdd(t)
            }}
          >
            <option value=''>{primary ? '其他分类…' : '选择分类…'}</option>
            {suggested.length > 1 && (
              <optgroup label='建议'>{suggested.slice(1).map(option)}</optgroup>
            )}
            {GROUPS.map((g) => (
              <optgroup key={g.scope} label={g.label}>
                {TAG_TARGETS.filter((t) => t.scope === g.scope).map(option)}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
    </li>
  )
}
