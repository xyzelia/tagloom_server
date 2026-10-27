// 事实 → 检索候选 → 确认 / 拒绝 → 锁定。
// 匹配依据、确认状态、锁定分开显示；精确命中也要用户确认；拒绝候选不删除事实。
import { type FormEvent, useState } from 'react'
import {
  addFact,
  applySearch,
  decideCandidate,
  type FieldDef,
  fieldDef,
  isSourceStale,
  removeFact,
  type Segment,
  setFactLocked,
  setFactStatus,
} from '@app/tagloom/share'
import { api, type ApiError, apiErrorOf, parseResponse } from '../api.ts'
import { DecisionTag, ErrorNotice, MatchTag, UnverifiedTag } from './common.tsx'

export function FactList(props: {
  fields: FieldDef[]
  segment: Segment
  profile: string
  onChange: (fn: (seg: Segment) => Segment) => void
}) {
  const { segment, profile, onChange } = props
  const [field, setField] = useState(props.fields[0].key)
  const [text, setText] = useState('')
  const [quote, setQuote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<ApiError | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    onChange((s) => addFact(s, { field, text, sourceQuote: quote }))
    setText('')
    setQuote('')
  }

  async function search(factId: string, factText: string, factField: string) {
    setBusy(factId)
    setError(null)
    try {
      const r = await parseResponse(
        api.catalog.search.$get({
          query: { q: factText, field: factField, limit: '8' },
        }),
      )
      const now = Date.now()
      onChange((s) => applySearch(s, factId, r.items, r.catalogVersion, now))
    } catch (e) {
      setError(apiErrorOf(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className='mt-3'>
      <p className='has-text-weight-semibold is-size-7 mb-1'>事实与候选</p>
      <ErrorNotice error={error} onClose={() => setError(null)} />
      {segment.facts.map((f) => {
        const stale = isSourceStale(f, profile)
        return (
          <div key={f.id} className='box p-3 mb-2'>
            <div className='is-flex is-flex-wrap-wrap is-align-items-center'>
              <span className='tags mb-0 mr-2'>
                <span className='tag'>
                  {fieldDef(f.field)?.label ?? f.field}
                </span>
                <DecisionTag decision={f.status} />
                {f.locked && <span className='tag is-dark'>🔒 已锁定</span>}
                {f.searchedAt && !f.searchVerified && <UnverifiedTag />}
                {stale && (
                  <span className='tag is-danger is-light'>
                    ⚠ 提取依据已变化
                  </span>
                )}
              </span>
              <strong className='mr-2'>{f.text}</strong>
              {f.sourceQuote && (
                <span className='is-size-7 has-text-grey mr-2'>
                  摘录：「{f.sourceQuote}」
                </span>
              )}
              <span className='buttons are-small ml-auto mb-0'>
                <button
                  type='button'
                  className={`button${busy === f.id ? ' is-loading' : ''}`}
                  disabled={f.locked}
                  onClick={() => search(f.id, f.text, f.field)}
                >
                  {f.searchedAt ? '重新检索' : '检索候选'}
                </button>
                <button
                  type='button'
                  className='button'
                  disabled={f.locked}
                  onClick={() =>
                    onChange((s) =>
                      setFactStatus(
                        s,
                        f.id,
                        f.status === 'rejected' ? 'pending' : 'rejected',
                      )
                    )}
                >
                  {f.status === 'rejected' ? '恢复事实' : '拒绝事实'}
                </button>
                <button
                  type='button'
                  className='button'
                  aria-pressed={f.locked}
                  onClick={() =>
                    onChange((s) => setFactLocked(s, f.id, !f.locked))}
                >
                  {f.locked ? '解锁' : '锁定'}
                </button>
                <button
                  type='button'
                  className='button is-danger is-outlined'
                  disabled={f.locked}
                  onClick={() => onChange((s) => removeFact(s, f.id))}
                >
                  删除
                </button>
              </span>
            </div>
            {f.searchedAt && f.searchVerified && f.candidates.length === 0 && (
              <p className='is-size-7 mt-2'>
                <MatchTag match='none' />{' '}
                词库没有命中；设定仍然有效，可以直接写进最终 Prompt。
              </p>
            )}
            {f.candidates.length > 0 && (
              <table className='table is-narrow is-fullwidth is-size-7 mt-2 mb-0'>
                <tbody>
                  {f.candidates.map((c) => (
                    <tr
                      key={c.id}
                      className={c.decision === 'rejected'
                        ? 'has-text-grey'
                        : ''}
                    >
                      <td className='text-nowrap'>
                        {c.tags.map((t) => (
                          <span key={t.canonical} className='mr-2'>
                            <strong>{t.canonical}</strong>{' '}
                            <span className='has-text-grey'>{t.labelZh}</span>
                          </span>
                        ))}
                      </td>
                      <td className='text-nowrap'>
                        <MatchTag match={c.match} />
                      </td>
                      <td>{c.reason}</td>
                      <td className='text-nowrap'>
                        <DecisionTag decision={c.decision} />
                      </td>
                      <td className='text-nowrap has-text-right'>
                        <span className='buttons are-small is-right mb-0'>
                          <button
                            type='button'
                            className='button is-success is-light'
                            disabled={f.locked || c.decision === 'confirmed'}
                            onClick={() =>
                              onChange((s) =>
                                decideCandidate(s, f.id, c.id, 'confirmed')
                              )}
                          >
                            确认
                          </button>
                          <button
                            type='button'
                            className='button'
                            disabled={f.locked || c.decision === 'rejected'}
                            onClick={() =>
                              onChange((s) =>
                                decideCandidate(s, f.id, c.id, 'rejected')
                              )}
                          >
                            拒绝
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
      <form className='field is-grouped is-grouped-multiline' onSubmit={submit}>
        <div className='control'>
          <div className='select is-small'>
            <select
              aria-label='事实所属字段'
              value={field}
              onChange={(e) => setField(e.target.value)}
            >
              {props.fields.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className='control is-expanded'>
          <input
            className='input is-small'
            placeholder='事实（如：蓝色牛仔裤、没有刘海）'
            aria-label='事实内容'
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className='control is-expanded'>
          <input
            className='input is-small'
            placeholder='档案摘录（可选，粘贴原文片段）'
            aria-label='档案摘录'
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
          />
        </div>
        <div className='control'>
          <button
            type='submit'
            className='button is-small'
            disabled={!text.trim()}
          >
            添加事实
          </button>
        </div>
      </form>
    </div>
  )
}
