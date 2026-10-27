// 一个分类：选词（自创标签 + 词库）→ 最终 Prompt 条目列表（勾选决定输出）→ 事实与候选。
// 选词区默认折叠：点开才挂载 TagPicker、才向服务端取词库标签，打开编辑页时不用一次渲染几十个按钮。
import { useState } from 'react'
import {
  type CustomTag,
  type CustomTagInput,
  fieldDef,
  pickCatalogTag,
  pickCustomTag,
  type Segment,
  type SegmentDef,
  setFieldState,
  tagRefOf,
  unpickCatalogTag,
  unpickCustomTag,
} from '@app/tagloom/share'
import { TagPicker } from './TagPicker.tsx'
import { PromptItemList } from './PromptItemList.tsx'
import { SegmentTagInput } from './SegmentTagInput.tsx'
import { FactList } from './FactList.tsx'

export function SegmentEditor(props: {
  def: SegmentDef
  segment: Segment
  profile: string
  customTags: CustomTag[]
  onChange: (fn: (seg: Segment) => Segment) => void
  // 把新标签加入角色标签库（人工创建），返回创建好的标签
  onCreateCustomTag: (input: CustomTagInput) => CustomTag
  hint?: string
}) {
  const { def, segment, onChange } = props
  const [showFacts, setShowFacts] = useState(segment.facts.length > 0)
  const [showPicker, setShowPicker] = useState(false)
  const states = Object.entries(segment.fieldStates)

  return (
    <div>
      {props.hint && (
        <p className='is-size-7 has-text-grey mb-2'>{props.hint}</p>
      )}
      <button
        type='button'
        className='button is-small is-text px-0 mb-2'
        aria-expanded={showPicker}
        onClick={() => setShowPicker(!showPicker)}
      >
        {showPicker ? '▾' : '▸'} 选词（词库 / 自创标签 / 字段状态）
      </button>
      {showPicker && (
        <TagPicker
          fields={def.fields}
          segment={segment}
          customTags={props.customTags}
          onPick={(field, tag, version) =>
            onChange((s) => pickCatalogTag(s, field, tagRefOf(tag, version)))}
          onPickCustom={(field, tag) =>
            onChange((s) => pickCustomTag(s, field, tag))}
          onUnpick={(canonical) =>
            onChange((s) => unpickCatalogTag(s, canonical))}
          onUnpickCustom={(customId) =>
            onChange((s) => unpickCustomTag(s, customId))}
          onCreateCustom={(field, input) => {
            const tag = props.onCreateCustomTag(input)
            onChange((s) => pickCustomTag(s, field, tag))
          }}
          onFieldState={(field, state) =>
            onChange((s) => setFieldState(s, field, state))}
        />
      )}
      {states.length > 0 && (
        <div className='tags mb-1'>
          {states.map(([field, state]) => (
            <span key={field} className='tag'>
              {fieldDef(field)?.label}：{state === 'open'
                ? '明确不固定（OPEN）'
                : '明确不适用（N/A）'}
            </span>
          ))}
        </div>
      )}
      <PromptItemList
        label={def.label}
        segment={segment}
        customTags={props.customTags}
        onChange={onChange}
        addBox={
          <SegmentTagInput
            def={def}
            segment={segment}
            customTags={props.customTags}
            onChange={onChange}
          />
        }
      />
      <button
        type='button'
        className='button is-small is-text px-0 mt-2'
        aria-expanded={showFacts}
        onClick={() => setShowFacts(!showFacts)}
      >
        {showFacts ? '▾' : '▸'} 事实与候选（{segment.facts.length}）
      </button>
      {showFacts && (
        <FactList
          fields={def.fields}
          segment={segment}
          profile={props.profile}
          onChange={onChange}
        />
      )}
    </div>
  )
}
