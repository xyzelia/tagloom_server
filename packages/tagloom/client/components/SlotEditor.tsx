// 场景里的一个人物槽位：快照（只读，分段开关）+ 场景对这个人物的补充 + 位置。
// 快照文本不能逐条改：要改就关掉那一段，在补充里自己写，或用「复制以改写」把那段复制成补充条目。
import { useState } from 'react'
import {
  type CharacterSlot,
  type CustomTag,
  type CustomTagInput,
  replaceSnapshot,
  type Segment,
  slotDisplayLabel,
  slotNegative,
  slotPrompt,
  SNAPSHOT_PART_LABEL,
  SNAPSHOT_PARTS,
  snapshotPartToExtra,
  userOrigin,
} from '@app/tagloom/share'
import {
  ConfirmModal,
  EnableToggle,
  formatTime,
  PreviewBlock,
} from './common.tsx'
import { CharacterPicker } from './CharacterPicker.tsx'
import { PromptItemList } from './PromptItemList.tsx'
import { SceneTagInput } from './SceneTagInput.tsx'

// 位置网格：5 × 5，取格子中心（0.1 … 0.9）
const GRID = [0.1, 0.3, 0.5, 0.7, 0.9]
const COLS = 'ABCDE'

export function SlotEditor(props: {
  slot: CharacterSlot
  index: number
  count: number
  customTags: CustomTag[]
  onChange: (fn: (slot: CharacterSlot) => CharacterSlot) => void
  onCreateCustomTag: (input: CustomTagInput) => CustomTag
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const { slot, index, onChange } = props
  const [picking, setPicking] = useState(false)
  const [removing, setRemoving] = useState(false)
  const snap = slot.snapshot
  const name = slotDisplayLabel(slot, index)
  const setExtra = (fn: (seg: Segment) => Segment) =>
    onChange((s) => ({ ...s, extra: fn(s.extra) }))

  return (
    <div className='box tagloom-slot'>
      <div className='field has-addons mb-3'>
        <div className='control is-expanded'>
          <input
            className='input has-text-weight-semibold'
            aria-label={`人物 ${index + 1} 的名称`}
            placeholder={snap?.title ?? `人物 ${index + 1}（可空）`}
            value={slot.label}
            onChange={(e) => {
              const v = e.target.value
              onChange((s) => ({ ...s, label: v }))
            }}
          />
        </div>
        <div className='control'>
          <button
            type='button'
            className='button'
            aria-label={`上移「${name}」`}
            disabled={index === 0}
            onClick={() => props.onMove(-1)}
          >
            ↑
          </button>
        </div>
        <div className='control'>
          <button
            type='button'
            className='button'
            aria-label={`下移「${name}」`}
            disabled={index === props.count - 1}
            onClick={() => props.onMove(1)}
          >
            ↓
          </button>
        </div>
        <div className='control'>
          <button
            type='button'
            className='button is-danger is-outlined'
            onClick={() => setRemoving(true)}
          >
            移除
          </button>
        </div>
      </div>

      {snap
        ? (
          <div className='mb-3'>
            <div className='is-flex is-flex-wrap-wrap is-align-items-center mb-2'>
              <span className='mr-2'>
                来自 <strong>{snap.title}</strong> / {snap.comboName ||
                  '未命名组合'} /{' '}
                {snap.stateId ? snap.stateName || '未命名状态' : '不使用状态'}
              </span>
              <span
                className='is-size-7 has-text-grey mr-2'
                title={snap.characterPath}
              >
                快照于 {formatTime(snap.takenAt)}
              </span>
              <div className='buttons are-small mb-0'>
                <button
                  type='button'
                  className='button mb-0'
                  onClick={() => setPicking(true)}
                >
                  重新选择
                </button>
                <button
                  type='button'
                  className='button mb-0'
                  title='去掉快照，只保留补充（变成纯手写人物）'
                  onClick={() => onChange((s) => ({ ...s, snapshot: null }))}
                >
                  移除快照
                </button>
              </div>
            </div>
            <table className='table is-narrow is-fullwidth is-size-7 mb-1 tagloom-snapshot-table'>
              <tbody>
                {SNAPSHOT_PARTS.map((k) => (
                  <tr key={k} className={snap.use[k] ? '' : 'prompt-item-off'}>
                    <th className='text-nowrap'>
                      <span className='is-flex is-align-items-center'>
                        <EnableToggle
                          on={snap.use[k]}
                          label={`快照的${SNAPSHOT_PART_LABEL[k]}`}
                          onChange={(v) =>
                            onChange((s) =>
                              s.snapshot
                                ? {
                                  ...s,
                                  snapshot: {
                                    ...s.snapshot,
                                    use: { ...s.snapshot.use, [k]: v },
                                  },
                                }
                                : s
                            )}
                        />
                        <span className='ml-2'>{SNAPSHOT_PART_LABEL[k]}</span>
                      </span>
                    </th>
                    <td>
                      <code className='tagloom-prompt'>
                        {snap[k] || '（空）'}
                      </code>
                    </td>
                    <td className='has-text-right'>
                      {k !== 'negative' && snap[k] && (
                        <button
                          type='button'
                          className='button is-small is-text'
                          title='快照文字不能直接改：把这段复制成下面「补充」里的一条文本条目，在那里改；同时关掉快照这段的输出，避免重复'
                          onClick={() =>
                            onChange((s) =>
                              snapshotPartToExtra(s, k, userOrigin())
                            )}
                        >
                          复制以改写
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className='help'>
              快照只读，人物之后的修改不会影响这里；要换表情 /
              状态请「重新选择」。
            </p>
          </div>
        )
        : (
          <div className='mb-3'>
            <p className='is-size-7 has-text-grey mb-2'>
              纯手写人物：在下面的补充里写。也可以从 TagLoom 人物导入一份快照。
            </p>
            <button
              type='button'
              className='button is-small is-primary is-light'
              onClick={() => setPicking(true)}
            >
              从人物导入
            </button>
          </div>
        )}

      <PromptItemList
        label={`${name} · 补充`}
        segment={slot.extra}
        customTags={props.customTags}
        onChange={setExtra}
        emptyHint='还没有条目。在下面输入框里搜词库标签、选场景自创标签，或直接输入文本。'
        addBox={
          <SceneTagInput
            label={`${name} · 补充`}
            segment={slot.extra}
            customTags={props.customTags}
            onChange={setExtra}
            onCreateCustomTag={props.onCreateCustomTag}
          />
        }
      />

      <div className='mt-3'>
        <p className='label is-small mb-1'>位置</p>
        <div className='is-flex is-align-items-flex-start'>
          <div
            className='tagloom-slot-grid mr-3'
            role='group'
            aria-label={`「${name}」在画面中的位置`}
          >
            {GRID.map((y, row) =>
              GRID.map((x, col) => {
                const on = slot.position?.x === x && slot.position?.y === y
                const cell = `${COLS[col]}${row + 1}`
                return (
                  <button
                    key={cell}
                    type='button'
                    className={`button is-small${on ? ' is-link' : ''}`}
                    aria-pressed={on}
                    title={`${cell}（x ${x}，y ${y}）`}
                    onClick={() =>
                      onChange((s) => ({
                        ...s,
                        position: on ? null : { x, y },
                      }))}
                  >
                    <span className='is-sr-only'>{cell}</span>
                  </button>
                )
              })
            )}
          </div>
          <p className='is-size-7 has-text-grey'>
            {slot.position
              ? `x ${slot.position.x}，y ${slot.position.y}（再点一次取消）`
              : '不指定（交给生成端自动安排）'}
          </p>
        </div>
      </div>

      <div className='mt-3'>
        <PreviewBlock label={`${name} · Prompt`} text={slotPrompt(slot)} />
        {slotNegative(slot) && (
          <PreviewBlock label={`${name} · 负面`} text={slotNegative(slot)} />
        )}
      </div>

      <CharacterPicker
        open={picking}
        initial={snap
          ? {
            characterPath: snap.characterPath,
            comboId: snap.comboId,
            stateId: snap.stateId,
          }
          : null}
        onPick={(next) => {
          onChange((s) => replaceSnapshot(s, next))
          setPicking(false)
        }}
        onCancel={() => setPicking(false)}
      />
      <ConfirmModal
        open={removing}
        title={`从场景移除「${name}」？`}
        confirmLabel='移除'
        onConfirm={() => {
          setRemoving(false)
          props.onRemove()
        }}
        onCancel={() => setRemoving(false)}
      >
        这个槽位的快照、补充和位置都会去掉（保存后生效）。人物文件本身不受影响。
      </ConfirmModal>
    </div>
  )
}
