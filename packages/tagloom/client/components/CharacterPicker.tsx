// 选择人物 → 造型组合 → 状态，生成一份快照放进场景槽位。
// 快照是一次性的：之后人物修改不影响场景；要换表情 / 状态就再打开这里重新选择。
// initial：重新选择时默认定位到原来的人物 / 组合 / 状态（人物文件不在了就提示另选）。
import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  buildSlotSnapshot,
  type SlotSnapshot,
  SNAPSHOT_PART_LABEL,
} from '@app/tagloom/share'
import { api, apiErrorOf, keys, parseResponse } from '../api.ts'
import { ErrorNotice, Loading } from './common.tsx'

export interface PickerInitial {
  characterPath: string
  comboId: string
  stateId: string | null
}

export function CharacterPicker(props: {
  open: boolean
  initial: PickerInitial | null
  onPick: (snapshot: SlotSnapshot) => void
  onCancel: () => void
}) {
  const titleId = useId()
  const onCancel = useRef(props.onCancel)
  onCancel.current = props.onCancel
  // 只在打开时读一次 initial（调用方每次渲染都会传新对象）
  const initial = useRef(props.initial)
  initial.current = props.initial
  const [q, setQ] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [comboId, setComboId] = useState<string | null>(null)
  // undefined：还没选（按 initial 或「不使用状态」）；null：不使用状态
  const [stateId, setStateId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (!props.open) return
    const init = initial.current
    setQ('')
    setPath(init?.characterPath ?? null)
    setComboId(init?.comboId ?? null)
    setStateId(init ? init.stateId : undefined)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel.current()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [props.open])

  const list = useQuery({
    queryKey: keys.search(q.trim()),
    queryFn: () =>
      parseResponse(api.characters.search.$get({ query: { q: q.trim() } })),
    enabled: props.open && path === null,
    staleTime: 0,
  })
  const character = useQuery({
    queryKey: keys.character(path ?? ''),
    queryFn: () =>
      parseResponse(api.characters.item.$get({ query: { path: path ?? '' } })),
    enabled: props.open && path !== null,
    staleTime: 0,
    retry: false,
  })

  if (!props.open) return null

  const c = character.data
  const combo = c?.combos.find((x) => x.id === comboId) ?? c?.combos[0] ?? null
  const state = combo && stateId
    ? combo.states.find((s) => s.id === stateId) ?? null
    : null
  const snapshot = c && combo && path
    ? buildSlotSnapshot(c, path, combo.id, state?.id ?? null, Date.now())
    : null

  return (
    <div
      className='modal is-active'
      role='dialog'
      aria-modal='true'
      aria-labelledby={titleId}
    >
      <div className='modal-background' onClick={props.onCancel} />
      <div className='modal-card tagloom-picker'>
        <header className='modal-card-head'>
          <p className='modal-card-title' id={titleId}>
            {path === null ? '选择人物' : '选择造型组合和状态'}
          </p>
          <button
            type='button'
            className='delete'
            aria-label='关闭'
            onClick={props.onCancel}
          />
        </header>
        <section className='modal-card-body'>
          {path === null
            ? (
              <>
                <input
                  className='input mb-3'
                  type='search'
                  aria-label='按名称或路径筛选人物'
                  placeholder='按名称或路径筛选人物'
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {list.isPending
                  ? <Loading />
                  : list.error
                  ? <ErrorNotice error={apiErrorOf(list.error)} />
                  : list.data.length === 0
                  ? <p className='has-text-grey'>没有找到人物。</p>
                  : (
                    <ul className='tagloom-picker-list'>
                      {list.data.map((s) => (
                        <li key={s.path}>
                          <button
                            type='button'
                            className='button is-fullwidth is-justify-content-flex-start mb-1'
                            onClick={() => {
                              setPath(s.path)
                              setComboId(null)
                              setStateId(undefined)
                            }}
                          >
                            <span className='has-text-weight-semibold mr-2'>
                              {s.title}
                            </span>
                            <span className='is-size-7 has-text-grey'>
                              {s.path} · {s.comboCount} 个组合
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </>
            )
            : (
              <>
                <p className='mb-3'>
                  <button
                    type='button'
                    className='button is-small is-text px-0'
                    onClick={() => setPath(null)}
                  >
                    ← 换一个人物
                  </button>
                  <span className='is-size-7 has-text-grey ml-2'>{path}</span>
                </p>
                {character.isPending ? <Loading /> : character.error
                  ? (
                    <ErrorNotice
                      error={apiErrorOf(character.error)}
                      action={
                        <p>
                          找不到原来的人物文件（可能已被移动、改名或删除），请换一个人物。场景里现有的快照不受影响。
                        </p>
                      }
                    />
                  )
                  : !combo
                  ? <p className='has-text-grey'>这个人物还没有造型组合。</p>
                  : (
                    <>
                      <div className='field is-grouped is-grouped-multiline'>
                        <div className='control'>
                          <label className='label is-small'>造型组合</label>
                          <div className='select is-small'>
                            <select
                              value={combo.id}
                              onChange={(e) => {
                                setComboId(e.target.value)
                                setStateId(null)
                              }}
                            >
                              {c!.combos.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name || '未命名组合'}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className='control'>
                          <label className='label is-small'>
                            角色状态（表情 / 动作）
                          </label>
                          <div className='select is-small'>
                            <select
                              value={state?.id ?? ''}
                              onChange={(e) =>
                                setStateId(e.target.value || null)}
                            >
                              <option value=''>不使用状态</option>
                              {combo.states.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name || '未命名状态'}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                      {stateId && !state && (
                        <p className='help theme-warning-text mb-2'>
                          原来选的状态已不在这个组合里，现在按「不使用状态」。
                        </p>
                      )}
                      {snapshot && (
                        <table className='table is-narrow is-fullwidth is-size-7'>
                          <tbody>
                            {([
                              'subject',
                              'base',
                              'costume',
                              'expression',
                              'action',
                              'negative',
                            ] as const)
                              .map((k) => (
                                <tr key={k}>
                                  <th className='text-nowrap'>
                                    {SNAPSHOT_PART_LABEL[k]}
                                  </th>
                                  <td>
                                    <code className='tagloom-prompt'>
                                      {snapshot[k] || '（空）'}
                                    </code>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
              </>
            )}
        </section>
        <footer className='modal-card-foot'>
          <div className='buttons'>
            <button
              type='button'
              className='button is-primary'
              disabled={!snapshot}
              onClick={() => snapshot && props.onPick(snapshot)}
            >
              使用这份快照
            </button>
            <button type='button' className='button' onClick={props.onCancel}>
              取消
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
