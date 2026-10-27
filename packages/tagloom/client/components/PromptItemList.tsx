// 最终 Prompt 条目列表：启用开关决定是否输出，可改写文本（权重）、拖动排序、删除。
// 左边的选择框只用于批量操作（启用 / 停用 / 删除），选中状态不保存；Shift + 点击选一段，表头选择框全选。
// 拖动排序用 dnd-kit（只从把手开始）；鼠标框选用 viselect（框中即选中，Ctrl / ⌘ / Shift 追加）。
// 添加输入框（选标签或加文本条目）由调用方通过 addBox 传入（SegmentTagInput）。
// 每条显示来源（词库 / 自创 / 文本）；人工添加是默认不标，AI 添加的标「AI」。
// 排列方式（item-layout.ts，编辑页顶部栏的 ItemLayoutSwitch 统一切换）：紧凑 = 一行放多条，来源改用左边框颜色表示（悬停看详情）；列表 = 一行一条。
import {
  type KeyboardEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type Active,
  closestCenter,
  DndContext,
  KeyboardSensor,
  type Modifier,
  type Over,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SelectionArea } from '@viselect/react'
import {
  type CustomTag,
  fieldDef,
  moveItem,
  moveItemTo,
  type PromptItem,
  removeItem,
  removeItems,
  type Segment,
  segmentText,
  setIncluded,
  setIncludedMany,
  setItemText,
} from '@app/tagloom/share'
import { ConfirmModal, CopyButton, EnableToggle } from './common.tsx'
import { onBracketKeyDown } from './bracket-input.ts'
import { useItemLayout } from './item-layout.ts'
import {
  clickSelect,
  emptySelection,
  replaceSelection,
  type Selection,
  toggleSelectAll,
  visibleSelection,
} from './selection.ts'

function SourceTag(
  { item, custom }: { item: PromptItem; custom: Map<string, CustomTag> },
) {
  const s = item.source
  if (s.kind === 'catalog') {
    return (
      <span
        className='tag is-link is-light'
        title={`${s.tag.canonical} · ${s.tag.labelZh} · ${s.tag.categoryPath}${
          s.tag.catalogVersion ? '' : '（未核查）'
        }`}
      >
        词库{s.tag.catalogVersion ? '' : '·未核查'}
      </span>
    )
  }
  if (s.kind === 'custom') {
    const t = custom.get(s.customId)
    if (!t) return <span className='tag is-danger is-light'>自创·已删除</span>
    return (
      <span
        className={`tag ${
          t.origin === 'agent' ? 'is-info' : 'is-primary'
        } is-light`}
        title={`${t.label || t.text}${
          t.text !== item.text ? `\n标签库文本：${t.text}` : ''
        }${t.origin === 'agent' ? '\nAI 创建的标签' : ''}`}
      >
        自创
      </span>
    )
  }
  return <span className='tag is-light'>文本</span>
}

// 紧凑排列时来源不单独显示：用左边框颜色区分（data-source），文字放进悬停提示
function sourceInfo(
  item: PromptItem,
  custom: Map<string, CustomTag>,
): { kind: string; text: string } {
  const s = item.source
  const extra = [
    item.field ? fieldDef(item.field)?.label : '',
    item.factId ? '来自事实' : '',
    item.origin === 'agent'
      ? (item.agentName ? `AI 添加：${item.agentName}` : 'AI 添加')
      : '',
  ].filter(Boolean)
  let kind: string
  let text: string
  if (s.kind === 'catalog') {
    kind = s.tag.catalogVersion ? 'catalog' : 'catalog-unchecked'
    text = `词库${
      s.tag.catalogVersion ? '' : '（未核查）'
    }：${s.tag.canonical} · ${s.tag.labelZh} · ${s.tag.categoryPath}`
  } else if (s.kind === 'custom') {
    const t = custom.get(s.customId)
    kind = t ? 'custom' : 'custom-missing'
    text = t ? `自创：${t.label || t.text}` : '自创（已删除）'
  } else {
    kind = 'text'
    text = '文本'
  }
  return { kind, text: [text, ...extra].join('\n') }
}

// 表头的全选框：部分选中时显示为「—」
function SelectAllBox(
  props: {
    checked: boolean
    mixed: boolean
    label: string
    onChange: () => void
  },
) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = props.mixed
  }, [props.mixed])
  return (
    <label
      className='prompt-item-select'
      title='全选 / 全不选（只用于批量操作）'
    >
      <input
        ref={ref}
        type='checkbox'
        checked={props.checked}
        aria-label={`选中「${props.label}」的全部条目`}
        onChange={props.onChange}
      />
    </label>
  )
}

// 框选（viselect）：只用鼠标（触屏上拖动是滚动页面）；单击不经过 viselect，由选择框自己处理；
// Shift 范围选择也由选择框处理。从文本框、按钮（开关、把手、删除）上按下不开始框选，
// 从选择框、来源标签、行的空白处按下拖动才框选。
const MARQUEE_FEATURES = {
  touch: false,
  range: false,
  singleTap: { allow: false, intersect: 'native' as const },
}
// overlap 'keep'：框到已选的行仍算选中（默认 'invert' 会把它反选掉）
// startThreshold 用 { x, y }：任一方向移动 4px 就开始。写成数字时 viselect 按「横向 + 纵向位移之和」判断，
// 斜着拖两个方向会抵消，起步明显迟钝
const MARQUEE_BEHAVIOUR = {
  startThreshold: { x: 4, y: 4 },
  overlap: 'keep' as const,
}
const NO_MARQUEE_START =
  'input:not([type=checkbox]), textarea, select, button, a, [contenteditable]'

// 列表排列时拖动只沿竖直方向；紧凑排列可以往任何方向拖
const verticalOnly: Modifier[] = [({ transform }) => ({ ...transform, x: 0 })]
const noModifiers: Modifier[] = []

function GripIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      width='1em'
      height='1em'
      fill='currentColor'
      aria-hidden='true'
    >
      {[6, 12, 18].map((y) =>
        [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r='1.6' />)
      )}
    </svg>
  )
}

// 一条条目。拖动排序只从把手开始（dnd-kit），文本框里拖动照常选文字；
// Alt + ↑ / ↓ 在这一行里任何位置都能移动（包括正在编辑文本时）。
// 窄屏上没有把手，改用 ↑ ↓ 按钮（紧凑排列时是 ← →，Alt + ← / → 也能移动）。
// memo：只有这一条的数据、位置或选中状态变了才重新渲染（框选 / 拖动时列表会频繁更新）。
// 回调和 custom 由列表保证引用稳定
const ItemRow = memo(function ItemRow(props: {
  item: PromptItem
  index: number
  count: number
  custom: Map<string, CustomTag>
  selected: boolean
  chips: boolean
  onSelectClick: (id: string, shift: boolean) => void
  onChange: (fn: (seg: Segment) => Segment) => void
}) {
  const { item, index, onChange, chips } = props
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })
  const lib = item.source.kind === 'custom'
    ? props.custom.get(item.source.customId)
    : undefined
  const move = (delta: number) => onChange((s) => moveItem(s, item.id, delta))
  const info = chips ? sourceInfo(item, props.custom) : null
  const [prevKey, nextKey] = chips
    ? ['ArrowLeft', 'ArrowRight']
    : ['ArrowUp', 'ArrowDown']

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-item-id={item.id}
      data-source={info?.kind}
      title={info?.text}
      className={`prompt-item-row${chips ? ' is-chip' : ''}${
        item.included ? '' : ' prompt-item-off'
      }${props.selected ? ' is-selected' : ''}${
        isDragging ? ' is-dragging' : ''
      }`}
      onKeyDown={(e) => {
        if (!e.altKey) return
        if (e.key === 'ArrowUp' || e.key === prevKey) {
          e.preventDefault()
          move(-1)
        } else if (e.key === 'ArrowDown' || e.key === nextKey) {
          e.preventDefault()
          move(1)
        }
      }}
    >
      <label
        className='prompt-item-select'
        title='选中（批量操作用）；Shift + 点击选中一段'
        // Shift + 点击时不要顺带选中页面文字
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      >
        <input
          type='checkbox'
          checked={props.selected}
          aria-label={`选中「${item.text}」`}
          onClick={(e) => props.onSelectClick(item.id, e.shiftKey)}
          // 由 onClick 处理（要读 Shift）；这里只为受控组件不报警告
          onChange={() => {}}
        />
      </label>
      <EnableToggle
        on={item.included}
        label={item.text}
        onChange={(v) => onChange((s) => setIncluded(s, item.id, v))}
      />
      <input
        className='input prompt-item-text'
        aria-label='条目文本'
        // 紧凑排列时宽度跟着文字走（CSS field-sizing；不支持的浏览器按字符数估）
        size={chips
          ? Math.max(2, Math.min(40, item.text.length + 1))
          : undefined}
        value={item.text}
        onChange={(e) => {
          const v = e.target.value
          onChange((s) => setItemText(s, item.id, v))
        }}
        // 括号辅助：选中后输入 ( [ { 包住选中文字、自动补右括号等
        onKeyDown={(e) =>
          onBracketKeyDown(
            e,
            (v) => onChange((s) => setItemText(s, item.id, v)),
          )}
      />
      <span className='prompt-item-meta'>
        {(!chips || info?.kind === 'custom-missing') && (
          <SourceTag item={item} custom={props.custom} />
        )}
        {item.origin === 'agent' && (
          <span
            className='tag is-info is-light'
            title={item.agentName ? `AI 添加：${item.agentName}` : 'AI 添加'}
          >
            AI
          </span>
        )}
        {!chips && item.field && (
          <span className='is-size-7 has-text-grey'>
            {fieldDef(item.field)?.label}
          </span>
        )}
        {!chips && item.factId && (
          <span className='is-size-7 has-text-grey'>来自事实</span>
        )}
        {lib && lib.text !== item.text && (
          <button
            type='button'
            className='button is-small is-text prompt-item-sync'
            title={`标签库当前文本：${lib.text}`}
            onClick={() => onChange((s) => setItemText(s, item.id, lib.text))}
          >
            {chips ? '更新' : '按标签库更新'}
          </button>
        )}
      </span>
      <span className='prompt-item-actions'>
        <button
          type='button'
          ref={setActivatorNodeRef}
          className='button prompt-item-icon prompt-item-handle'
          {...attributes}
          {...listeners}
          aria-label={`拖动排序「${item.text}」`}
          title={chips
            ? '拖动排序（也可以按 Alt + ← / →）'
            : '拖动排序（也可以按 Alt + ↑ / ↓）'}
        >
          <GripIcon />
        </button>
        <button
          type='button'
          className='button prompt-item-icon prompt-item-step'
          aria-label={`上移「${item.text}」`}
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          {chips ? '←' : '↑'}
        </button>
        <button
          type='button'
          className='button prompt-item-icon prompt-item-step'
          aria-label={`下移「${item.text}」`}
          disabled={index === props.count - 1}
          onClick={() => move(1)}
        >
          {chips ? '→' : '↓'}
        </button>
        <button
          type='button'
          className='button prompt-item-icon is-delete'
          aria-label={`删除条目「${item.text}」`}
          onClick={() => onChange((s) => removeItem(s, item.id))}
        >
          ✕
        </button>
      </span>
    </div>
  )
})

// 列表里和框选矩形（视口坐标）有重叠的行；只是边挨着不算，水平拖动时选中鼠标所在的那一行
function rowsInArea(
  rows: Element,
  a: { x1: number; y1: number; x2: number; y2: number },
): Element[] {
  const [left, right] = a.x1 < a.x2 ? [a.x1, a.x2] : [a.x2, a.x1]
  const [top, bottom] = a.y1 < a.y2 ? [a.y1, a.y2] : [a.y2, a.y1]
  return [...rows.querySelectorAll(':scope > .prompt-item-row')].filter(
    (el) => {
      const r = el.getBoundingClientRect()
      return r.left < right && r.right > left && r.top < bottom &&
        r.bottom > top
    },
  )
}

// 两个集合内容相同
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x))

export function PromptItemList(props: {
  label: string
  segment: Segment
  customTags: CustomTag[]
  onChange: (fn: (seg: Segment) => Segment) => void
  addBox: ReactNode
  // 没有条目时的说明；默认提到选词区（场景页没有选词区）
  emptyHint?: string
}) {
  const { segment, onChange } = props
  const custom = useMemo(
    () => new Map(props.customTags.map((t) => [t.id, t])),
    [props.customTags],
  )
  const out = segmentText(segment)
  // ids 的引用必须稳定：它传给 SortableContext，引用一变 dnd-kit 会让所有行重新渲染（memo 也挡不住）
  const ids = useMemo(() => segment.items.map((i) => i.id), [segment.items])
  const [sel, setSel] = useState<Selection>(emptySelection)
  const [deleting, setDeleting] = useState(false)
  const chips = useItemLayout() === 'chips'
  // 给 memo 的行用的稳定回调：调用方每次渲染可能传新的 onChange，条目顺序也会变，经 ref 取最新值
  const latest = useRef({ onChange, ids, items: segment.items })
  latest.current = { onChange, ids, items: segment.items }
  const stableOnChange = useCallback(
    (fn: (seg: Segment) => Segment) => latest.current.onChange(fn),
    [],
  )
  const selectClick = useCallback(
    (id: string, shift: boolean) =>
      setSel((s) => clickSelect(s, latest.current.ids, id, shift)),
    [],
  )
  // 条目可能被别处删掉（如取消选词），只看还在的
  const selected = visibleSelection(sel, ids)
  const count = selected.size

  const clear = () => setSel(emptySelection)
  // 当前这次框选：所在列表的行容器、开始前已选的（追加模式）
  const marquee = useRef<{ rows: Element | null; base: Set<string> }>({
    rows: null,
    base: new Set(),
  })
  const applyMarquee = (hitRows: Element[]) => {
    const { rows, base } = marquee.current
    // 页面上有很多条目列表，只取本列表里的行
    const hit = hitRows
      .filter((el) => rows?.contains(el))
      .map((el) => (el as HTMLElement).dataset.itemId)
      .filter((id): id is string => !!id)
    const next = new Set([...base, ...hit])
    // 框选时每一帧都会调用；命中的行没变就不更新，避免整列表重绘
    setSel((s) => (sameSet(s.ids, next) ? s : replaceSelection(next)))
  }

  const sensors = useSensors(
    // 移动 4px 才算拖动，点一下把手不会触发
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // 键盘移动到视口边缘时立即滚动（默认平滑滚动在滚动未完成前不会换位置）
      scrollBehavior: 'auto',
    }),
  )
  // 读屏播报（dnd-kit 默认是英文）。经 ref 取最新条目，对象本身只建一次，避免每次渲染都让 DndContext 更新
  const accessibility = useMemo(() => {
    const textOf = (id: UniqueIdentifier) =>
      latest.current.items.find((i) => i.id === id)?.text ?? ''
    const posOf = (id: UniqueIdentifier) =>
      latest.current.ids.indexOf(String(id)) + 1
    return {
      screenReaderInstructions: {
        draggable:
          '按空格或回车拿起这一条，用上下方向键移动，再按空格或回车放下；Esc 取消。也可以直接按 Alt + 上下方向键移动。',
      },
      announcements: {
        onDragStart: ({ active }: { active: Active }) =>
          `已拿起「${textOf(active.id)}」，当前第 ${posOf(active.id)} 条。`,
        onDragOver: ({ active, over }: { active: Active; over: Over | null }) =>
          over
            ? `「${textOf(active.id)}」移到第 ${posOf(over.id)} 条的位置。`
            : `「${textOf(active.id)}」不在列表上方。`,
        onDragEnd: ({ active, over }: { active: Active; over: Over | null }) =>
          over
            ? `「${textOf(active.id)}」已放到第 ${posOf(over.id)} 条。`
            : `已放下「${textOf(active.id)}」，顺序不变。`,
        onDragCancel: ({ active }: { active: Active }) =>
          `已取消拖动，「${textOf(active.id)}」回到原位。`,
      },
    }
  }, [])

  // 只在选择框 / 按钮上响应，文本框里的 Ctrl+A、Esc 照常
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (t instanceof HTMLInputElement && t.type !== 'checkbox') return
    if (t instanceof HTMLTextAreaElement) return
    if (e.key === 'Escape' && count > 0) {
      e.preventDefault()
      clear()
    } else if (
      e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey) && ids.length
    ) {
      e.preventDefault()
      setSel({ ids: new Set(ids), anchor: null })
    }
  }

  return (
    <div className='mt-2'>
      {
        /* 批量操作放在表头这一行里（固定高度），出现时不把下面的条目往下推，避免点错行；
         有选中时这一行吸顶 */
      }
      <div className={`prompt-item-head${count > 0 ? ' is-active' : ''}`}>
        {ids.length > 0 && (
          <SelectAllBox
            checked={count > 0 && count === ids.length}
            mixed={count > 0 && count < ids.length}
            label={props.label}
            onChange={() => setSel((s) => toggleSelectAll(s, ids))}
          />
        )}
        {count === 0
          ? (
            <>
              <p className='label is-small mb-0'>
                {props.label} · 最终 Prompt
              </p>
              {ids.length > 0 && (
                <span className='is-size-7 has-text-grey ml-2'>
                  {ids.length} 条
                </span>
              )}
            </>
          )
          : (
            <div
              className='prompt-item-bulk'
              role='toolbar'
              aria-label={`「${props.label}」批量操作`}
            >
              <span className='mr-1'>已选 {count} / {ids.length} 条</span>
              <button
                type='button'
                className='button is-small'
                onClick={() =>
                  onChange((s) => setIncludedMany(s, selected, true))}
              >
                启用
              </button>
              <button
                type='button'
                className='button is-small'
                onClick={() =>
                  onChange((s) => setIncludedMany(s, selected, false))}
              >
                停用
              </button>
              <button
                type='button'
                className='button is-small is-danger is-outlined'
                onClick={() => setDeleting(true)}
              >
                删除…
              </button>
              <button
                type='button'
                className='button is-small is-text'
                title='Esc'
                onClick={clear}
              >
                取消选择
              </button>
            </div>
          )}
      </div>
      {segment.items.length === 0 && (
        <p className='is-size-7 has-text-grey mb-2'>
          {props.emptyHint ??
            '还没有条目。在下面输入框里搜标签或直接输入文本，也可以展开上面的选词区。'}
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={chips ? noModifiers : verticalOnly}
        accessibility={accessibility}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id) {
            onChange((s) => moveItemTo(s, String(active.id), String(over.id)))
          }
        }}
      >
        <SortableContext
          items={ids}
          strategy={chips ? rectSortingStrategy : verticalListSortingStrategy}
        >
          <SelectionArea
            className={`prompt-item-rows${chips ? ' is-chips' : ''}`}
            selectables='.prompt-item-row'
            selectionAreaClass='prompt-item-marquee'
            selectionContainerClass='prompt-item-marquee-clip'
            features={MARQUEE_FEATURES}
            behaviour={MARQUEE_BEHAVIOUR}
            // 按下鼠标时（还没开始框选）：决定能不能从这里开始，并记下所在列表和修饰键。
            // 注意 start 事件带的是第一次移动的事件，那时鼠标可能已经离开列表，不能在那里取
            onBeforeStart={({ event }) => {
              const t = event?.target
              if (!(t instanceof Element) || t.closest(NO_MARQUEE_START)) {
                return false
              }
              marquee.current = {
                rows: t.closest('.prompt-item-rows'),
                // 按住 Ctrl / ⌘ / Shift 框选：在已选的基础上追加
                base: event?.ctrlKey || event?.metaKey || event?.shiftKey
                  ? new Set(selected)
                  : new Set(),
              }
            }}
            onStart={({ selection }) => {
              // 选中状态由本组件管理；viselect 每次结束会把结果存进自己的 stored，
              // 不清掉会在下次框选时干扰命中结果
              selection.clearSelection(true, true)
              globalThis.getSelection?.()?.removeAllRanges()
            }}
            onMove={({ store }) => applyMarquee(store.selected)}
            // viselect 在动画帧里更新框的范围，松手太快（或页面卡顿）时它最后的结果可能是旧的；
            // 结束时直接按鼠标起点 / 终点围成的矩形算命中的行
            onStop={({ selection }) => {
              const rows = marquee.current.rows
              if (rows) {
                applyMarquee(rowsInArea(rows, selection.getAreaLocation()))
              }
            }}
            onKeyDown={onKeyDown}
          >
            {segment.items.map((item, idx) => (
              <ItemRow
                key={item.id}
                item={item}
                index={idx}
                count={ids.length}
                custom={custom}
                selected={selected.has(item.id)}
                chips={chips}
                onSelectClick={selectClick}
                onChange={stableOnChange}
              />
            ))}
          </SelectionArea>
        </SortableContext>
      </DndContext>
      {props.addBox}
      <div className='is-flex is-align-items-center is-size-7'>
        <span className='has-text-grey mr-2'>本分类输出：</span>
        <code className='mr-2 tagloom-prompt'>{out || '（空）'}</code>
        <CopyButton text={out} />
      </div>
      <ConfirmModal
        open={deleting}
        title={`删除选中的 ${count} 条？`}
        confirmLabel='删除'
        onConfirm={() => {
          onChange((s) => removeItems(s, selected))
          setDeleting(false)
          clear()
        }}
        onCancel={() => setDeleting(false)}
      >
        从「{props
          .label}」里去掉这些条目（保存后生效）。只想暂时不输出的话，用「停用」。
      </ConfirmModal>
    </div>
  )
}
