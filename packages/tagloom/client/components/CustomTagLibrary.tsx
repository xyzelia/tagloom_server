// 自创标签库（人物 / 场景各一份）：列出自创标签，显示创建来源（👤 人工 / 🤖 AI + agent 名称）、用量；可改文本、说明，可删除。
// 修改标签库文本不会改动已在用的条目（条目旁会出现「按标签库更新」）；删除标签也保留已在用的条目。
import { useState } from 'react'
import {
  type CustomTag,
  fieldDef,
  ORIGIN_LABEL,
  removeCustomTag,
  updateCustomTag,
} from '@app/tagloom/share'
import { ConfirmModal, formatTime } from './common.tsx'

export function CustomTagLibrary<T extends { customTags: CustomTag[] }>(props: {
  content: T
  // 各标签被多少个条目使用（含未勾选）
  usage: Map<string, number>
  onChange: (fn: (c: T) => T) => void
  // 场景的标签不分字段：不显示「适用字段」列
  showFields?: boolean
  // 没有标签时的说明
  emptyHint?: string
}) {
  const { content, onChange, usage } = props
  const showFields = props.showFields ?? true
  const [removing, setRemoving] = useState<CustomTag | null>(null)
  const [filter, setFilter] = useState<'all' | 'user' | 'agent'>('all')
  const tags = content.customTags.filter((t) =>
    filter === 'all' || t.origin === filter
  )

  if (content.customTags.length === 0) {
    return (
      <p className='is-size-7 has-text-grey'>
        {props.emptyHint ??
          '还没有自创标签。在任意分类的选词区点「＋ 自创标签」创建；之后 AI 也可以往这里添加（会标为 🤖 AI）。'}
      </p>
    )
  }

  return (
    <>
      <div className='tabs is-small is-toggle mb-2'>
        <ul>
          {(['all', 'user', 'agent'] as const).map((k) => (
            <li key={k} className={filter === k ? 'is-active' : ''}>
              <a
                href='#'
                onClick={(e) => {
                  e.preventDefault()
                  setFilter(k)
                }}
              >
                {k === 'all' ? '全部' : ORIGIN_LABEL[k]}
                <span className='tag is-rounded is-small'>
                  {k === 'all'
                    ? content.customTags.length
                    : content.customTags.filter((t) =>
                      t.origin === k
                    ).length}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <table className='table is-narrow is-fullwidth is-size-7'>
        <thead>
          <tr>
            <th>Prompt 文本</th>
            <th>中文说明</th>
            <th>创建来源</th>
            {showFields && <th>适用字段</th>}
            <th>用量</th>
            <th>
              <span className='is-sr-only'>操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tags.map((t) => (
            <tr key={t.id}>
              <td>
                <input
                  className='input is-small'
                  aria-label='自创标签 Prompt 文本'
                  value={t.text}
                  onChange={(e) => {
                    const v = e.target.value
                    onChange((c) => updateCustomTag(c, t.id, { text: v }))
                  }}
                />
              </td>
              <td>
                <input
                  className='input is-small'
                  aria-label='自创标签中文说明'
                  value={t.label}
                  onChange={(e) => {
                    const v = e.target.value
                    onChange((c) => updateCustomTag(c, t.id, { label: v }))
                  }}
                />
              </td>
              <td className='text-nowrap'>
                <span
                  className={`tag ${
                    t.origin === 'agent' ? 'is-info' : 'is-primary'
                  } is-light`}
                >
                  {ORIGIN_LABEL[t.origin]}
                </span>
                {t.agentName && <span className='ml-1'>{t.agentName}</span>}
                <br />
                <span className='has-text-grey'>{formatTime(t.createdAt)}</span>
              </td>
              {showFields && (
                <td>
                  {t.fields.length === 0
                    ? <span className='has-text-grey'>所有字段</span>
                    : t.fields.map((f) => fieldDef(f)?.label ?? f).join('、')}
                </td>
              )}
              <td>{usage.get(t.id) ?? 0}</td>
              <td className='has-text-right'>
                <button
                  type='button'
                  className='button is-small is-danger is-outlined'
                  onClick={() => setRemoving(t)}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className='is-size-7 has-text-grey'>
        改这里的文本不会改动已在用的条目；条目旁会出现「按标签库更新」由你决定是否同步。
      </p>
      <ConfirmModal
        open={removing !== null}
        title={`从标签库删除「${removing?.label || removing?.text || ''}」？`}
        confirmLabel='删除'
        onConfirm={() => {
          if (removing) onChange((c) => removeCustomTag(c, removing.id))
          setRemoving(null)
        }}
        onCancel={() => setRemoving(null)}
      >
        {(removing && usage.get(removing.id))
          ? `有 ${
            usage.get(removing.id)
          } 个条目在用这个标签。删除后这些条目保留（文本不变），只是标为「自创·已删除」。`
          : '没有条目在用这个标签。'}
      </ConfirmModal>
    </>
  )
}
