// 字段选词：本角色的自创标签 + 字段对应的词库分类（浏览 / 搜索）。点选后作为勾选的条目加入最终 Prompt，
// 再点一次取消勾选（条目保留，可在条目列表里重新勾选、改写或排序）；不会自动锁定。
// 也可以在这里新建自创标签（记为人工创建）。
import { type FormEvent, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  type CatalogTag,
  type CustomTag,
  type CustomTagInput,
  customTagsForField,
  type FieldDef,
  type FieldState,
  ORIGIN_LABEL,
  type Segment,
} from '@app/tagloom/share'
import { api, apiErrorOf, keys, parseResponse } from '../api.ts'
import { ErrorNotice, UnverifiedTag } from './common.tsx'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const STRATEGY_NOTE: Record<FieldDef['strategy'], string> = {
  category_filtered:
    '候选来自对应词库分类，仍需按语义挑选（分类里可能混有状态词）',
  cross_category_curated: '候选跨多个词库分类，需按语义精选',
  text_first: '以自由描述为主，词库只作辅助',
  metadata_only: '仅资料，不对应标签；请用事实或最终 Prompt 记录',
}

export function TagPicker(props: {
  fields: FieldDef[]
  segment: Segment
  customTags: CustomTag[]
  onPick: (field: string, tag: CatalogTag, catalogVersion: string) => void
  onPickCustom: (field: string, tag: CustomTag) => void
  // 再点已选的标签：取消勾选
  onUnpick: (canonical: string) => void
  onUnpickCustom: (customId: string) => void
  // 新建自创标签（加入角色标签库）并在当前分类选用
  onCreateCustom: (field: string, input: CustomTagInput) => void
  onFieldState: (field: string, state: FieldState | null) => void
}) {
  const { fields, segment } = props
  const [fieldKey, setFieldKey] = useState(fields[0].key)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const dq = useDebounced(q.trim(), 250)
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0]
  const browsable = field.categoryPaths.length > 0

  const tags = useQuery({
    queryKey: keys.fieldTags(field.key, dq),
    queryFn: () =>
      parseResponse(
        api.catalog['field-tags'].$get({ query: { field: field.key, q: dq } }),
      ),
    enabled: browsable,
    staleTime: 60_000,
  })

  // 已在本分类输出的条目（勾选中）
  const picked = new Set(
    segment.items.filter((i) => i.included && i.source.kind === 'catalog').map((
      i,
    ) => i.source.kind === 'catalog' ? i.source.tag.canonical : ''),
  )
  const pickedCustom = new Set(
    segment.items.filter((i) => i.included && i.source.kind === 'custom').map((
      i,
    ) => i.source.kind === 'custom' ? i.source.customId : ''),
  )
  const fieldCustom = customTagsForField(props.customTags, field.key)
  const state = segment.fieldStates[field.key] ?? ''
  const main = fields.filter((f) => !f.optional)
  const optional = fields.filter((f) => f.optional)
  // 头发字段前加小类别名（发色 / 发型）；字段名本身就是小类别名时不重复
  const groupLabel = (f: FieldDef) => {
    const g = f.group === 'hair_color'
      ? '发色'
      : f.group === 'hair_style'
      ? '发型'
      : ''
    return g && g !== f.label ? `${g} · ` : ''
  }
  const option = (f: FieldDef) => (
    <option key={f.key} value={f.key}>
      {groupLabel(f)}
      {f.label}
      {segment.fieldStates[f.key]
        ? `（${segment.fieldStates[f.key] === 'open' ? 'OPEN' : 'N/A'}）`
        : ''}
    </option>
  )

  return (
    <div className='box is-shadowless tagloom-picker-surface p-3'>
      <div className='field is-grouped is-grouped-multiline mb-2'>
        <div className='control'>
          <div className='select is-small'>
            <select
              aria-label='选词字段'
              value={field.key}
              onChange={(e) => {
                setFieldKey(e.target.value)
                setQ('')
              }}
            >
              {main.map(option)}
              {optional.length > 0 && (
                <optgroup label='更多（可选）'>{optional.map(option)}</optgroup>
              )}
            </select>
          </div>
        </div>
        <div className='control is-expanded'>
          <input
            className='input is-small'
            type='search'
            placeholder={browsable
              ? '在本字段的词库分类内搜索（中文 / 英文 / 别名）'
              : '本字段没有对应词库分类'}
            aria-label='搜索标签'
            value={q}
            disabled={!browsable}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className='control'>
          <div className='select is-small'>
            <select
              aria-label='字段值状态'
              value={state}
              onChange={(e) =>
                props.onFieldState(
                  field.key,
                  (e.target.value || null) as FieldState | null,
                )}
            >
              <option value=''>未填写 / 已赋值</option>
              <option value='open'>明确不固定（OPEN）</option>
              <option value='na'>明确不适用（N/A）</option>
            </select>
          </div>
        </div>
        <div className='control'>
          <button
            type='button'
            className='button is-small'
            aria-expanded={creating}
            onClick={() => setCreating(!creating)}
          >
            ＋ 自创标签
          </button>
        </div>
      </div>
      <p className='is-size-7 has-text-grey mb-2'>
        {STRATEGY_NOTE[field.strategy]}
        {field.note && `。${field.note}`}
        {field.examples.length > 0 && `。示例：${field.examples.join('、')}`}
      </p>
      {creating && (
        <NewCustomTagForm
          fieldKey={field.key}
          fieldLabel={field.label}
          onCancel={() => setCreating(false)}
          onCreate={(input) => {
            props.onCreateCustom(field.key, input)
            setCreating(false)
          }}
        />
      )}
      {fieldCustom.length > 0 && (
        <div className='mb-2'>
          <span className='is-size-7 has-text-grey mr-2'>角色自创标签：</span>
          {fieldCustom.map((t) => {
            const on = pickedCustom.has(t.id)
            return (
              <button
                type='button'
                key={t.id}
                className={`button is-small mr-1 mb-1${on ? ' is-link' : ''}`}
                title={[
                  t.label,
                  `创建：${ORIGIN_LABEL[t.origin]}${
                    t.agentName ? ` · ${t.agentName}` : ''
                  }`,
                  t.note,
                  on ? '已选用，再点一次取消勾选' : '',
                ].filter(Boolean).join('\n')}
                aria-pressed={on}
                onClick={() =>
                  on
                    ? props.onUnpickCustom(t.id)
                    : props.onPickCustom(field.key, t)}
              >
                {on && <span aria-hidden='true' className='mr-1'>✓</span>}
                <span aria-hidden='true' className='mr-1'>
                  {t.origin === 'agent' ? '🤖' : '👤'}
                </span>
                <span>{t.label || t.text}</span>
                {t.label && (
                  <span className='has-text-grey ml-1 is-size-7'>{t.text}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {browsable && (
        tags.error
          ? <ErrorNotice error={apiErrorOf(tags.error)} />
          : tags.data && !tags.data.verified
          ? (
            <p className='is-size-7'>
              <UnverifiedTag /> {tags.data.reason}
            </p>
          )
          : (
            <div className='tag-picker-list'>
              {tags.isPending && (
                <p className='is-size-7 has-text-grey'>加载中…</p>
              )}
              {tags.data?.verified && tags.data.items.length === 0 && (
                <p className='is-size-7 has-text-grey'>
                  没有找到；可以新建自创标签、在最终 Prompt
                  里加文本条目，或添加为事实。
                </p>
              )}
              {tags.data?.verified && tags.data.items.map((t) => {
                const on = picked.has(t.canonical)
                return (
                  <button
                    type='button'
                    key={t.canonical}
                    className={`button is-small mr-1 mb-1${
                      on ? ' is-link' : ''
                    }`}
                    title={[
                      `${t.canonical}（${
                        t.categoryLabelZh || t.categoryPath
                      }）`,
                      t.aliases.length
                        ? `别名／译名：${t.aliases.join('、')}`
                        : '',
                      t.notes && `说明：${t.notes}`,
                      `来源：${t.sources.join('、') || '-'}`,
                      `来源图库频次 ${t.postCount.toLocaleString()}`,
                      on ? '已选用，再点一次取消勾选' : '',
                    ].filter(Boolean).join('\n')}
                    aria-pressed={on}
                    onClick={() =>
                      on ? props.onUnpick(t.canonical) : props.onPick(
                        field.key,
                        t,
                        tags.data!.catalogVersion!,
                      )}
                  >
                    {on && <span aria-hidden='true' className='mr-1'>✓</span>}
                    <span>{t.labelZh || t.canonical}</span>
                    <span className='has-text-grey ml-1 is-size-7'>
                      {t.canonical}
                    </span>
                  </button>
                )
              })}
            </div>
          )
      )}
    </div>
  )
}

function NewCustomTagForm(props: {
  fieldKey: string
  fieldLabel: string
  onCreate: (input: CustomTagInput) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')
  const [onlyField, setOnlyField] = useState(true)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    props.onCreate({ text, label, fields: onlyField ? [props.fieldKey] : [] })
  }
  return (
    <form className='box p-3 mb-2' onSubmit={submit}>
      <p className='is-size-7 has-text-grey mb-2'>
        自创标签存在本角色的标签库里（记为 👤 人工创建），Base
        与各组合都能选用。
      </p>
      <div className='field is-grouped is-grouped-multiline mb-1'>
        <div className='control is-expanded'>
          <input
            className='input is-small'
            placeholder='Prompt 文本（必填，可含权重），如 star-shaped ahoge'
            aria-label='自创标签 Prompt 文本'
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className='control is-expanded'>
          <input
            className='input is-small'
            placeholder='中文说明（可选），如 星形呆毛'
            aria-label='自创标签中文说明'
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      </div>
      <label className='checkbox is-size-7 mr-3'>
        <input
          type='checkbox'
          className='mr-1'
          checked={onlyField}
          onChange={(e) => setOnlyField(e.target.checked)}
        />
        只在「{props.fieldLabel}」字段显示（不勾选则所有字段都显示）
      </label>
      <span className='buttons are-small is-inline-flex mb-0 ml-2'>
        <button
          type='submit'
          className='button is-primary'
          disabled={!text.trim()}
        >
          创建并选用
        </button>
        <button type='button' className='button' onClick={props.onCancel}>
          取消
        </button>
      </span>
    </form>
  )
}
