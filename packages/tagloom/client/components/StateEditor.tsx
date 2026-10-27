// 角色状态编辑：名称 / 备注 / 种子 → 神态与表情 → 动作与姿势 → （末尾，默认折叠）外观与服饰调整。
// 状态与表情、动作是同一个连接实体，不是各自独立的库。
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  ACTION_SEGMENT,
  type Base,
  BASE_OVERRIDE_TARGETS,
  type CharacterState,
  type Combo,
  COSTUME_OVERRIDE_TARGETS,
  type CustomTag,
  type CustomTagInput,
  EXPRESSION_SEGMENT,
  hasSegmentContent,
  MAX_CHARACTER_STATES,
  overrideSegmentDef,
  overrideTargetLabel,
  resolveEffectiveSegment,
  type Segment,
  segmentText,
  type StateOverrideTarget,
} from '@app/tagloom/share'
import { ContentBadge, Section } from './Section.tsx'
import { SegmentEditor } from './SegmentEditor.tsx'
import {
  adjustmentsHeader,
  clearOverrideOutput,
  copyParentToOverride,
  OVERRIDE_CHOICE_LABEL,
  type OverrideChoice,
  overrideChoice,
  parentSegmentFor,
  parseSeedInput,
  SEED_MAX,
  seedText,
  setOverrideChoice,
  updateOverrideContent,
  withStateSeed,
} from './state-ui.ts'

// 校验状态上报：key → 错误文本；null 表示无错误。有任何错误时页面禁止保存。
export type ReportInvalid = (key: string, error: string | null) => void

export interface TagLibProps {
  customTags: CustomTag[]
  onCreateCustomTag: (input: CustomTagInput) => CustomTag
}

// 种子输入框：文本草稿本地保存，仅在合法时提交；非法时显示错误并上报，不改动已存值。
export function SeedField(props: {
  id: string
  label: string
  value: number | undefined
  allowEmpty: boolean
  onCommit: (v: number | undefined) => void
  reportInvalid: ReportInvalid
  help?: string
}) {
  const { id, value, allowEmpty } = props
  const [text, setText] = useState(seedText(value))
  const report = useRef(props.reportInvalid)
  report.current = props.reportInvalid
  const parsed = parseSeedInput(text, allowEmpty)
  const error = parsed.ok ? null : parsed.error

  // 外部更新（重新加载、AI 合并）时与存储值同步；自己提交的值不触发重置
  useEffect(() => {
    const p = parseSeedInput(text, allowEmpty)
    if (!(p.ok && p.value === value)) setText(seedText(value))
    // deno-lint-ignore react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    report.current(id, error)
  }, [id, error])
  useEffect(() => () => report.current(id, null), [id])

  return (
    <div className='field'>
      <label className='label is-small' htmlFor={id}>{props.label}</label>
      <input
        id={id}
        className={`input is-small${error ? ' is-danger' : ''}`}
        inputMode='numeric'
        autoComplete='off'
        placeholder={`0–${SEED_MAX}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-msg`}
        value={text}
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          const p = parseSeedInput(v, allowEmpty)
          if (p.ok) props.onCommit(p.value)
        }}
      />
      {error
        ? (
          <p id={`${id}-msg`} className='help is-danger' role='alert'>
            {error}（未写入，修正前无法保存）
          </p>
        )
        : props.help
        ? <p id={`${id}-msg`} className='help'>{props.help}</p>
        : <span id={`${id}-msg`} />}
    </div>
  )
}

function StateSeed(props: {
  state: CharacterState
  characterSeed: number | undefined
  onChange: (fn: (s: CharacterState) => CharacterState) => void
  reportInvalid: ReportInvalid
}) {
  const { state, characterSeed } = props
  const [specific, setSpecific] = useState(state.seed !== undefined)
  useEffect(() => {
    setSpecific(state.seed !== undefined)
  }, [state.seed])
  const name = `state-seed-mode-${state.id}`
  return (
    <fieldset className='field'>
      <legend className='label is-small'>种子</legend>
      <div className='control'>
        <label className='radio mr-4'>
          <input
            type='radio'
            name={name}
            checked={!specific}
            onChange={() => {
              setSpecific(false)
              props.onChange((s) => withStateSeed(s, undefined))
            }}
          />{' '}
          沿用人物种子
        </label>
        <label className='radio'>
          <input
            type='radio'
            name={name}
            checked={specific}
            onChange={() => setSpecific(true)}
          />{' '}
          本状态指定
        </label>
      </div>
      {specific
        ? (
          <SeedField
            id={`state-seed-${state.id}`}
            label='本状态种子'
            value={state.seed}
            allowEmpty={false}
            reportInvalid={props.reportInvalid}
            onCommit={(v) => props.onChange((s) => withStateSeed(s, v))}
          />
        )
        : (
          <p className='help'>
            {characterSeed === undefined
              ? '人物未设置默认种子：此状态没有有效种子。'
              : `使用人物种子 ${characterSeed}。`}
          </p>
        )}
    </fieldset>
  )
}

export function StateEditor(props: {
  state: CharacterState
  combo: Combo
  base: Base
  characterSeed: number | undefined
  profile: string
  lib: TagLibProps
  onChange: (fn: (s: CharacterState) => CharacterState) => void
  reportInvalid: ReportInvalid
}) {
  const { state, onChange } = props
  const seg = (key: 'expression' | 'action') => (fn: (s: Segment) => Segment) =>
    onChange((s) => ({ ...s, [key]: fn(s[key]) }))
  return (
    <div className='box tagloom-state-editor'>
      <div className='field'>
        <label className='label is-small' htmlFor={`state-name-${state.id}`}>
          状态名称
          <ContentBadge filled={state.name.trim().length > 0} />
        </label>
        <input
          id={`state-name-${state.id}`}
          className='input is-small'
          placeholder='如：微笑站立、战斗姿态'
          value={state.name}
          onChange={(e) => {
            const v = e.target.value
            onChange((s) => ({ ...s, name: v }))
          }}
        />
      </div>
      <div className='field'>
        <label className='label is-small' htmlFor={`state-note-${state.id}`}>
          备注
        </label>
        <textarea
          id={`state-note-${state.id}`}
          className='textarea is-small'
          rows={2}
          placeholder='可空；仅记录，不进入 Prompt'
          value={state.note}
          onChange={(e) => {
            const v = e.target.value
            onChange((s) => ({ ...s, note: v }))
          }}
        />
      </div>
      <StateSeed
        state={state}
        characterSeed={props.characterSeed}
        onChange={onChange}
        reportInvalid={props.reportInvalid}
      />
      <Section
        title='神态与表情'
        hasContent={hasSegmentContent(state.expression)}
        defaultOpen
      >
        <SegmentEditor
          def={EXPRESSION_SEGMENT}
          segment={state.expression}
          profile={props.profile}
          {...props.lib}
          onChange={seg('expression')}
        />
      </Section>
      <Section
        title='动作与姿势'
        hasContent={hasSegmentContent(state.action)}
        defaultOpen
      >
        <SegmentEditor
          def={ACTION_SEGMENT}
          segment={state.action}
          profile={props.profile}
          {...props.lib}
          onChange={seg('action')}
        />
      </Section>
      <StateAdjustments
        state={state}
        combo={props.combo}
        base={props.base}
        profile={props.profile}
        lib={props.lib}
        onChange={onChange}
      />
    </div>
  )
}

// 外观与服饰调整：位置固定在状态编辑器末尾；实际优先级仍是 Base → 组合 → 状态。
export function StateAdjustments(props: {
  state: CharacterState
  combo: Combo
  base: Base
  profile: string
  lib: TagLibProps
  defaultOpen?: boolean
  onChange: (fn: (s: CharacterState) => CharacterState) => void
}) {
  const { state } = props
  const head = adjustmentsHeader(state)
  const group = (title: string, targets: readonly StateOverrideTarget[]) => (
    <div className='mb-3'>
      <h4 className='title is-6 mb-2'>{title}</h4>
      {targets.map((t) => (
        <OverrideCategory
          key={t}
          target={t}
          state={state}
          parent={parentSegmentFor(props.base, props.combo, t)}
          profile={props.profile}
          lib={props.lib}
          onChange={props.onChange}
        />
      ))}
    </div>
  )
  return (
    <Section
      title='外观与服饰调整'
      hasContent={head.count > 0}
      defaultOpen={props.defaultOpen ?? false}
      summary={
        <span data-testid='adjustments-summary'>
          {head.count > 0 ? `已配置 ${head.text}` : head.text}
        </span>
      }
    >
      <p className='is-size-7 has-text-grey mb-3'>
        仅在本状态内调整；实际优先级仍是 Base → 组合 →
        状态。默认沿用造型，不会把身份信息复制进状态。
      </p>
      {group('Base 固定外貌', BASE_OVERRIDE_TARGETS as StateOverrideTarget[])}
      {group('服装', COSTUME_OVERRIDE_TARGETS as StateOverrideTarget[])}
    </Section>
  )
}

function PromptText(props: { label: string; text: string }) {
  return (
    <div className='mb-2'>
      <span className='is-size-7 has-text-grey'>{props.label}</span>
      <pre className='is-size-7 p-2 tagloom-prompt'>{props.text || '（空）'}</pre>
    </div>
  )
}

function OverrideCategory(props: {
  target: StateOverrideTarget
  state: CharacterState
  parent: Segment
  profile: string
  lib: TagLibProps
  onChange: (fn: (s: CharacterState) => CharacterState) => void
}) {
  const { target, state, parent, onChange } = props
  const choice = overrideChoice(state, target)
  const override = state.overrides?.[target]
  const label = overrideTargetLabel(target)
  const name = `override-${state.id}-${target}`
  const effective = segmentText(resolveEffectiveSegment(parent, override))
  let body: ReactNode = null
  if (choice === 'inherit') {
    body = (
      <PromptText label='造型当前内容（只读）' text={segmentText(parent)} />
    )
  } else if (override) {
    body = (
      <>
        {choice === 'append'
          ? <PromptText label='保留的造型内容' text={segmentText(parent)} />
          : (
            <>
              <PromptText
                label='造型原内容（本状态不使用）'
                text={segmentText(parent)}
              />
              <div className='buttons are-small mb-2'>
                <button
                  type='button'
                  className='button'
                  onClick={() =>
                    onChange((s) => copyParentToOverride(s, target, parent))}
                >
                  复制造型内容到这里
                </button>
                <button
                  type='button'
                  className='button'
                  onClick={() =>
                    onChange((s) => clearOverrideOutput(s, target))}
                >
                  本状态不输出此分类
                </button>
              </div>
            </>
          )}
        <SegmentEditor
          def={overrideSegmentDef(target)}
          segment={override.content}
          profile={props.profile}
          {...props.lib}
          hint={choice === 'append'
            ? '这里添加的内容接在造型内容之后'
            : undefined}
          onChange={(fn) =>
            onChange((s) => updateOverrideContent(s, target, fn))}
        />
        <PromptText label='本状态有效内容（预览）' text={effective} />
      </>
    )
  }
  return (
    <fieldset className='box p-3 mb-2'>
      <legend className='label is-small'>{label}</legend>
      <div className='control mb-2'>
        {(['inherit', 'append', 'replace'] as OverrideChoice[]).map((c) => (
          <label key={c} className='radio mr-4'>
            <input
              type='radio'
              name={name}
              value={c}
              checked={choice === c}
              onChange={() =>
                onChange((s) => setOverrideChoice(s, target, c))}
            />{' '}
            {OVERRIDE_CHOICE_LABEL[c]}
          </label>
        ))}
      </div>
      {body}
    </fieldset>
  )
}

// 组合下的状态列表：选择 / 新增 / 复制 / 删除
export function StateList(props: {
  states: CharacterState[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const selected = props.states.find((s) => s.id === props.selectedId)
  return (
    <div>
      <div className='buttons are-small mb-2'>
        {props.states.map((s) => (
          <button
            key={s.id}
            type='button'
            className={`button${s.id === props.selectedId ? ' is-info' : ''}`}
            aria-pressed={s.id === props.selectedId}
            onClick={() =>
              props.onSelect(s.id === props.selectedId ? null : s.id)}
          >
            {s.name || '未命名状态'}
          </button>
        ))}
        <button
          type='button'
          className='button is-primary is-light'
          disabled={props.states.length >= MAX_CHARACTER_STATES}
          onClick={props.onAdd}
        >
          ＋ 新状态
        </button>
        {selected && (
          <>
            <button
              type='button'
              className='button'
              disabled={props.states.length >= MAX_CHARACTER_STATES}
              onClick={props.onDuplicate}
            >
              复制当前状态
            </button>
            <button
              type='button'
              className='button is-danger is-outlined'
              onClick={props.onRemove}
            >
              删除当前状态
            </button>
          </>
        )}
      </div>
      {props.states.length >= MAX_CHARACTER_STATES && (
        <p className='help is-warning'>
          每个组合最多 {MAX_CHARACTER_STATES}{' '}
          个状态，删除状态后可继续新增或复制。
        </p>
      )}
      {props.states.length === 0 && (
        <p className='is-size-7 has-text-grey'>
          还没有状态。状态把表情、动作和造型调整连在一起；只调整服饰的状态同样有效。
        </p>
      )}
      <p className='is-size-7 has-text-grey'>
        再次点击已选状态可取消选择，回到组合预览。
      </p>
    </div>
  )
}
