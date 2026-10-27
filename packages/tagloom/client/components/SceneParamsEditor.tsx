// 场景编辑：可选的生成参数（尺寸、种子、采样……），用于复现。每项都可留空，留空由生成端决定。
// 不引用任何生成端的选项列表：模型、采样器等按原文填写，tagloom 只存不校验是否被支持。
import { useEffect, useRef, useState } from 'react'
import {
  SCENE_PARAM_LABEL,
  SCENE_PARAM_LIMITS,
  SCENE_PARAM_TEXT_MAX,
  type SceneNumberParam,
  type SceneParams,
  type SceneTextParam,
} from '@app/tagloom/share'
import { type ReportInvalid, SeedField } from './StateEditor.tsx'
import { SEED_MAX } from './state-ui.ts'

type NumberKey = Exclude<SceneNumberParam, 'seed'>
type TextKey = SceneTextParam

const PLACEHOLDER: Record<NumberKey, string> = {
  width: '如 832',
  height: '如 1216',
  steps: '如 28',
  scale: '如 5',
  cfgRescale: '0–1',
}

const TEXT_PLACEHOLDER: Record<TextKey, string> = {
  model: '如 nai-diffusion-4-5-full',
  sampler: '如 k_euler_ancestral',
  noiseSchedule: '如 karras',
}

export function parseParamNumber(
  text: string,
  rule: { min: number; max: number; int: boolean },
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const t = text.trim()
  if (t === '') return { ok: true, value: undefined }
  const n = Number(t)
  if (!Number.isFinite(n)) return { ok: false, error: '请输入数字' }
  if (rule.int && !Number.isInteger(n)) {
    return { ok: false, error: '请输入整数' }
  }
  if (n < rule.min || n > rule.max) {
    return { ok: false, error: `范围 ${rule.min}–${rule.max}` }
  }
  return { ok: true, value: n }
}

const numText = (v: number | undefined) => (v === undefined ? '' : String(v))

// 数值输入：文本草稿本地保存，仅在合法时提交；非法时显示错误并上报（同 SeedField）
function NumberParam(props: {
  id: string
  k: NumberKey
  value: number | undefined
  onCommit: (v: number | undefined) => void
  reportInvalid: ReportInvalid
}) {
  const { id, k, value } = props
  const rule = SCENE_PARAM_LIMITS[k]
  const [text, setText] = useState(numText(value))
  const report = useRef(props.reportInvalid)
  report.current = props.reportInvalid
  const parsed = parseParamNumber(text, rule)
  const error = parsed.ok ? null : parsed.error

  useEffect(() => {
    const p = parseParamNumber(text, rule)
    if (!(p.ok && p.value === value)) setText(numText(value))
  }, [value])

  useEffect(() => {
    report.current(id, error)
  }, [id, error])
  useEffect(() => () => report.current(id, null), [id])

  return (
    <div className='field'>
      <label className='label is-small' htmlFor={id}>
        {SCENE_PARAM_LABEL[k]}
      </label>
      <input
        id={id}
        className={`input is-small${error ? ' is-danger' : ''}`}
        inputMode={rule.int ? 'numeric' : 'decimal'}
        autoComplete='off'
        placeholder={PLACEHOLDER[k]}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-msg` : undefined}
        value={text}
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          const p = parseParamNumber(v, rule)
          if (p.ok) props.onCommit(p.value)
        }}
      />
      {error && (
        <p id={`${id}-msg`} className='help is-danger' role='alert'>
          {error}（未写入，修正前无法保存）
        </p>
      )}
    </div>
  )
}

function TextParam(props: {
  id: string
  k: TextKey
  value: string | undefined
  onCommit: (v: string | undefined) => void
}) {
  return (
    <div className='field'>
      <label className='label is-small' htmlFor={props.id}>
        {SCENE_PARAM_LABEL[props.k]}
      </label>
      <input
        id={props.id}
        className='input is-small'
        autoComplete='off'
        maxLength={SCENE_PARAM_TEXT_MAX}
        placeholder={TEXT_PLACEHOLDER[props.k]}
        value={props.value ?? ''}
        onChange={(e) => props.onCommit(e.target.value || undefined)}
      />
    </div>
  )
}

// 折叠标题上的一行摘要；一项都没填时 undefined
export function sceneParamsSummary(p: SceneParams | undefined) {
  if (!p) return undefined
  const parts: string[] = []
  if (p.width !== undefined || p.height !== undefined) {
    parts.push(`${p.width ?? '?'}×${p.height ?? '?'}`)
  }
  if (p.seed !== undefined) parts.push(`种子 ${p.seed}`)
  const rest = ([
    'model',
    'steps',
    'scale',
    'cfgRescale',
    'sampler',
    'noiseSchedule',
  ] as const).filter((k) => p[k] !== undefined && p[k] !== '').length
  if (rest) parts.push(`另 ${rest} 项`)
  return parts.length ? parts.join(' · ') : undefined
}

export function SceneParamsEditor(props: {
  value: SceneParams | undefined
  onChange: (fn: (p: SceneParams) => SceneParams) => void
  reportInvalid: ReportInvalid
}) {
  const p = props.value ?? {}
  const set = <K extends keyof SceneParams>(k: K, v: SceneParams[K]) =>
    props.onChange((cur) => {
      const { [k]: _drop, ...rest } = cur
      return v === undefined ? rest : { ...rest, [k]: v }
    })
  const num = (k: NumberKey) => (
    <NumberParam
      id={`tagloom-scene-param-${k}`}
      k={k}
      value={p[k]}
      onCommit={(v) => set(k, v)}
      reportInvalid={props.reportInvalid}
    />
  )
  const txt = (k: TextKey) => (
    <TextParam
      id={`tagloom-scene-param-${k}`}
      k={k}
      value={p[k]}
      onCommit={(v) => set(k, v)}
    />
  )
  return (
    <>
      <p className='is-size-7 has-text-grey mb-2'>
        都是可选的，用于复现。留空的项由生成端（模板 / 默认值）决定；
        导出和发送时原样带出。
      </p>
      <div className='columns is-multiline is-mobile is-variable is-2'>
        <div className='column is-6-mobile is-3-tablet'>{num('width')}</div>
        <div className='column is-6-mobile is-3-tablet'>{num('height')}</div>
        <div className='column is-12-mobile is-6-tablet'>
          <SeedField
            id='tagloom-scene-param-seed'
            label={SCENE_PARAM_LABEL.seed}
            value={p.seed}
            allowEmpty
            reportInvalid={props.reportInvalid}
            onCommit={(v) => set('seed', v)}
          />
          <button
            type='button'
            className='button is-small is-text px-1'
            style={{ marginTop: '-0.5rem' }}
            onClick={() =>
              set('seed', Math.floor(Math.random() * (SEED_MAX + 1)))}
          >
            随机生成一个
          </button>
        </div>
        <div className='column is-12'>{txt('model')}</div>
        <div className='column is-6-mobile is-3-tablet'>{num('steps')}</div>
        <div className='column is-6-mobile is-3-tablet'>{num('scale')}</div>
        <div className='column is-6-mobile is-3-tablet'>
          {num('cfgRescale')}
        </div>
        <div className='column is-6-mobile is-3-tablet' />
        <div className='column is-6'>{txt('sampler')}</div>
        <div className='column is-6'>{txt('noiseSchedule')}</div>
      </div>
      {props.value && Object.keys(props.value).length > 0 && (
        <button
          type='button'
          className='button is-small'
          onClick={() => props.onChange(() => ({}))}
        >
          清空全部参数
        </button>
      )}
    </>
  )
}
