// 标签筛选（自然语言）：输入一段描述，列出词库里可能相关的标签（宁多勿漏），按可信程度分层。
// 结果只在页面内存里；输入和勾选放 sessionStorage，刷新后还在，关掉标签页就没了。
// 标签列表保持紧凑；宽屏时右侧详情栏显示鼠标停留 / 键盘聚焦的标签（分类层级、来源等），
// 窄屏时点标签旁的 ⓘ 从底部弹出。
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  TEXT_MATCH_TIER_LABEL,
  type TextMatchTag,
  type TextMatchTier,
} from '@app/tagloom/share'
import { api, apiErrorOf, keys, parseResponse } from '../api.ts'
import {
  BottomSheet,
  CopyButton,
  ErrorNotice,
  Loading,
  UnverifiedTag,
  useTitle,
} from '../components/common.tsx'

const STORE_TEXT = 'tagloom.text-match.text'
const STORE_PICKED = 'tagloom.text-match.picked'
const TIERS: TextMatchTier[] = ['exact', 'loose', 'related', 'single']
const TIER_HELP: Record<TextMatchTier, string> = {
  exact: '词库里的词原样出现在描述里',
  loose: '字不挨着（撑着伞 → 撑伞）或词序不同（long blue hair → blue hair）',
  related: '名字里包含上面命中的词，供扩展参考',
  single: '单个汉字命中，误中较多',
}
// 每层先渲染这么多，其余点「显示全部」
const PAGE = 120
// 鼠标停留这么久才切换详情，划过一排标签时详情栏不跟着闪
const HOVER_DELAY = 150
// 详情栏里浏览分类时每次多取这么多
const BROWSE_PAGE = 60

// 正在查看的标签；hit 是筛选结果里的那一条（带原文依据），从分类浏览里点开的没有
interface Inspect {
  canonical: string
  hit?: TextMatchTag
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存不了（隐私模式等）就只留在内存里
  }
}

const evidenceText = (tag: TextMatchTag) =>
  tag.hits.map((h) => h.text === h.term ? h.text : `${h.text} → ${h.term}`)
    .join('；')

export default function TextMatch() {
  useTitle('标签筛选')
  const [text, setText] = useState(() => load(STORE_TEXT, ''))
  const [picked, setPicked] = useState<string[]>(() => load(STORE_PICKED, []))
  const [filter, setFilter] = useState('')
  const [inspect, setInspect] = useState<Inspect | null>(null)
  // 固定后鼠标划过其他标签不再切换（浏览分类时自动固定）
  const [pinned, setPinned] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => save(STORE_TEXT, text), [text])
  useEffect(() => save(STORE_PICKED, picked), [picked])
  useEffect(() => () => clearTimeout(timer.current), [])

  // delay：鼠标悬停用；键盘聚焦立即切换
  const show = useCallback((next: Inspect, delay = 0) => {
    clearTimeout(timer.current)
    if (pinned) return
    if (delay) timer.current = setTimeout(() => setInspect(next), delay)
    else setInspect(next)
  }, [pinned])
  const cancelHover = useCallback(() => clearTimeout(timer.current), [])
  const closeSheet = useCallback(() => setSheetOpen(false), [])

  const match = useMutation({
    mutationFn: (q: string) =>
      parseResponse(api.catalog.match.$post({ json: { text: q } })),
  })
  const run = () => {
    if (text.trim()) match.mutate(text)
  }
  const data = match.data
  const result = data?.verified ? data : null

  const toggle = (canonical: string) =>
    setPicked((p) =>
      p.includes(canonical)
        ? p.filter((x) => x !== canonical)
        : [...p, canonical]
    )

  const events: TagEvents = {
    onToggle: toggle,
    onHover: (t) => show({ canonical: t.canonical, hit: t }, HOVER_DELAY),
    onLeave: cancelHover,
    onFocus: (t) => show({ canonical: t.canonical, hit: t }),
    onInfo: (t) => {
      setInspect({ canonical: t.canonical, hit: t })
      setSheetOpen(true)
    },
  }

  const f = filter.trim().toLowerCase()
  const visible =
    result?.candidates.filter((t) =>
      !f || t.canonical.includes(f) || t.labelZh.toLowerCase().includes(f) ||
      t.aliases.some((a) => a.toLowerCase().includes(f))
    ) ?? []

  return (
    <>
      <h1 className='title is-4 mb-4'>标签筛选</h1>

      <div className='field'>
        <label className='label' htmlFor='tagloom-text-match-input'>
          描述（中文 / 英文）
        </label>
        <div className='control'>
          <textarea
            id='tagloom-text-match-input'
            className='textarea'
            rows={4}
            maxLength={8000}
            placeholder='例如：蓝色长发的少女穿着水手服，在雨中撑着伞，表情有点害羞'
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                run()
              }
            }}
          />
        </div>
        <p className='help'>
          粗筛：宁多勿漏，每个结果都对应描述里的某一段。只比对标签名、中文名和别名，不搜索说明（notes）。Ctrl
          + Enter 筛选。
        </p>
      </div>
      <div className='buttons'>
        <button
          type='button'
          className={`button is-primary${match.isPending ? ' is-loading' : ''}`}
          disabled={!text.trim()}
          onClick={run}
        >
          筛选
        </button>
        <button
          type='button'
          className='button'
          disabled={!text}
          onClick={() => setText('')}
        >
          清空描述
        </button>
      </div>

      <Picked picked={picked} setPicked={setPicked} />

      {match.error && <ErrorNotice error={apiErrorOf(match.error)} />}
      {data && !data.verified && (
        <p className='mb-4'>
          <UnverifiedTag /> {data.reason}
        </p>
      )}

      {result && (
        <div className='columns'>
          <div className='column'>
            <p className='is-size-7 has-text-grey mb-3'>
              {result.total} 个候选
              {result.total > result.candidates.length &&
                `（只显示前 ${result.candidates.length} 个）`} · 词库{' '}
              {result.catalogVersion}
            </p>
            {result.categoryHints.length > 0 && (
              <Chips label='提到的分类'>
                {result.categoryHints.map((h) => (
                  <span
                    key={h.path}
                    className='tag is-info is-light'
                    title={h.path}
                  >
                    {h.text} → {h.labelZh || h.path}
                  </span>
                ))}
              </Chips>
            )}
            {result.unmatched.length > 0 && (
              <Chips label='没有命中'>
                {result.unmatched.map((u) => (
                  <span key={u} className='tag is-light'>{u}</span>
                ))}
              </Chips>
            )}
            {result.total > 0 && (
              <div className='field mt-3'>
                <input
                  className='input is-small'
                  type='search'
                  placeholder='在结果里过滤（中文 / 英文 / 别名，不含说明）'
                  aria-label='在结果里过滤'
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            )}
            {result.total === 0 && (
              <p className='has-text-grey'>没有找到相关的标签。</p>
            )}
            {TIERS.map((tier) => {
              const tags = visible.filter((t) => t.tier === tier)
              return tags.length > 0 && (
                <TierBlock
                  key={`${tier}:${match.submittedAt}`}
                  {...events}
                  tier={tier}
                  tags={tags}
                  picked={picked}
                  active={inspect?.canonical ?? null}
                />
              )
            })}
          </div>
          <div className='column is-4 is-hidden-mobile'>
            <div className='tagloom-text-match-detail box p-3'>
              {inspect
                ? (
                  <TagDetail
                    key={inspect.canonical}
                    inspect={inspect}
                    picked={picked}
                    onToggle={toggle}
                    pinned={pinned}
                    onPin={setPinned}
                    onOpen={(canonical) => setInspect({ canonical })}
                  />
                )
                : (
                  <p className='is-size-7 has-text-grey'>
                    把鼠标停在标签上（或用 Tab
                    键选到标签），这里显示它的分类层级、别名和来源。
                  </p>
                )}
            </div>
          </div>
        </div>
      )}
      <BottomSheet title='标签详情' open={sheetOpen} onClose={closeSheet}>
        {inspect && (
          <TagDetail
            key={inspect.canonical}
            inspect={inspect}
            picked={picked}
            onToggle={toggle}
            onOpen={(canonical) => setInspect({ canonical })}
          />
        )}
      </BottomSheet>
    </>
  )
}

function Chips(props: { label: string; children: ReactNode }) {
  return (
    <div className='is-flex is-flex-wrap-wrap is-align-items-center mb-2'>
      <span className='is-size-7 has-text-grey mr-2'>{props.label}：</span>
      <div className='tags mb-0'>{props.children}</div>
    </div>
  )
}

function Picked(props: {
  picked: string[]
  setPicked: (p: string[]) => void
}) {
  const { picked, setPicked } = props
  if (!picked.length) return null
  const out = picked.join(', ')
  return (
    <div className='box p-3 mb-4'>
      <div className='is-flex is-flex-wrap-wrap is-justify-content-space-between is-align-items-center mb-2'>
        <span className='has-text-weight-semibold'>
          已选 {picked.length} 个
        </span>
        <div className='buttons mb-0'>
          <CopyButton text={out} />
          <button
            type='button'
            className='button is-small'
            onClick={() => setPicked([])}
          >
            清空已选
          </button>
        </div>
      </div>
      <div className='tags mb-0'>
        {picked.map((c) => (
          <span key={c} className='tag is-primary is-light'>
            {c}
            <button
              type='button'
              className='delete is-small'
              aria-label={`取消选择 ${c}`}
              onClick={() => setPicked(picked.filter((x) => x !== c))}
            />
          </span>
        ))}
      </div>
    </div>
  )
}

interface TagEvents {
  onToggle: (canonical: string) => void
  onHover: (tag: TextMatchTag) => void
  onLeave: () => void
  onFocus: (tag: TextMatchTag) => void
  onInfo: (tag: TextMatchTag) => void
}

function TierBlock(
  props: TagEvents & {
    tier: TextMatchTier
    tags: TextMatchTag[]
    picked: string[]
    active: string | null
  },
) {
  const { tier, tags } = props
  const [all, setAll] = useState(false)
  // 可信度低的两层默认收起
  const [open, setOpen] = useState(tier === 'exact' || tier === 'loose')
  const shown = all ? tags : tags.slice(0, PAGE)
  return (
    <details
      className='tagloom-text-match-tier box p-3 mb-3'
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className='has-text-weight-semibold'>
        {TEXT_MATCH_TIER_LABEL[tier]}（{tags.length}）
        <span className='is-size-7 has-text-grey has-text-weight-normal ml-2'>
          {TIER_HELP[tier]}
        </span>
      </summary>
      {open && (
        <div className='tagloom-text-match-list mt-3'>
          {shown.map((t) => (
            <TagButton
              key={t.canonical}
              {...props}
              tag={t}
              picked={props.picked.includes(t.canonical)}
              active={props.active === t.canonical}
            />
          ))}
          {tags.length > shown.length && (
            <button
              type='button'
              className='button is-small is-text'
              onClick={() => setAll(true)}
            >
              显示全部 {tags.length} 个
            </button>
          )}
        </div>
      )}
    </details>
  )
}

function TagButton(
  props: TagEvents & {
    tag: TextMatchTag
    picked: boolean
    active: boolean
  },
) {
  const { tag, picked } = props
  return (
    <span
      className={`tagloom-text-match-item${props.active ? ' is-active' : ''}`}
    >
      <button
        type='button'
        className={`tagloom-text-match-tag button is-small${
          picked ? ' is-primary' : ''
        }`}
        aria-pressed={picked}
        onClick={() => props.onToggle(tag.canonical)}
        onMouseEnter={() => props.onHover(tag)}
        onMouseLeave={props.onLeave}
        onFocus={() => props.onFocus(tag)}
      >
        <span aria-hidden='true' className='mr-1'>{picked ? '✓' : '+'}</span>
        <span className='has-text-weight-semibold'>
          {tag.labelZh || tag.canonical}
        </span>
        <span className='tagloom-text-match-canonical ml-1'>
          {tag.canonical}
        </span>
        <span className='tagloom-text-match-evidence ml-1'>
          · {evidenceText(tag)}
        </span>
      </button>
      <button
        type='button'
        className='button is-small is-hidden-tablet'
        aria-label={`查看 ${tag.canonical} 的详情`}
        onClick={() => props.onInfo(tag)}
      >
        ⓘ
      </button>
    </span>
  )
}

// 一个标签的详情：名称、分类层级（每层可浏览）、依据、别名、各来源的原始记录
function TagDetail(props: {
  inspect: Inspect
  picked: string[]
  onToggle: (canonical: string) => void
  // 窄屏的底部面板不需要固定
  pinned?: boolean
  onPin?: (pinned: boolean) => void
  // 在分类浏览里点 ⓘ 时切换到那个标签
  onOpen: (canonical: string) => void
}) {
  const { inspect, picked, onPin } = props
  const [browse, setBrowse] = useState<string | null>(null)
  const detail = useQuery({
    queryKey: keys.tagDetail(inspect.canonical),
    queryFn: () =>
      parseResponse(
        api.catalog.tag.$get({ query: { canonical: inspect.canonical } }),
      ),
    staleTime: Infinity,
  })
  if (detail.error) return <ErrorNotice error={apiErrorOf(detail.error)} />
  if (!detail.data) return <Loading />
  if (!detail.data.verified) {
    return (
      <p>
        <UnverifiedTag /> {detail.data.reason}
      </p>
    )
  }
  const tag = detail.data.tag
  const isPicked = picked.includes(tag.canonical)
  const own = tag.categoryTrail.at(-1)
  const openBrowse = (path: string) => {
    setBrowse(path)
    onPin?.(true)
  }
  const names = [tag.labelEn !== tag.canonical && tag.labelEn, tag.labelJa]
    .filter(Boolean).join(' · ')

  return (
    <div className='tagloom-text-match-detail-body'>
      <div className='is-flex is-justify-content-space-between is-align-items-start'>
        <div>
          <p className='has-text-weight-semibold'>
            {tag.labelZh || tag.canonical}{' '}
            <span className='has-text-weight-normal'>{tag.canonical}</span>
          </p>
          <p className='is-size-7 has-text-grey'>
            {names && `${names} · `}频次 {tag.postCount.toLocaleString()}
          </p>
        </div>
        {onPin && (
          <button
            type='button'
            className={`button is-small${props.pinned ? ' is-info' : ''}`}
            aria-pressed={props.pinned}
            title='固定后，鼠标划过其他标签不会切换这里的内容'
            onClick={() => onPin(!props.pinned)}
          >
            {props.pinned ? '📌 已固定' : '固定'}
          </button>
        )}
      </div>
      <div className='buttons mt-2 mb-2'>
        <button
          type='button'
          className={`button is-small${isPicked ? ' is-primary' : ''}`}
          aria-pressed={isPicked}
          onClick={() => props.onToggle(tag.canonical)}
        >
          {isPicked ? '✓ 已选' : '+ 选择'}
        </button>
        <CopyButton text={tag.canonical} label='复制 canonical' />
      </div>

      <DetailRow label='分类'>
        <nav className='tagloom-text-match-trail' aria-label='分类层级'>
          {tag.categoryTrail.map((c, i) => (
            <span key={c.path}>
              {i > 0 && <span aria-hidden='true' className='mx-1'>›</span>}
              <button
                type='button'
                className='button is-text is-small p-0'
                title={`${c.path}${
                  c.labelEn ? `（${c.labelEn}）` : ''
                }：浏览这一层的标签`}
                onClick={() => openBrowse(c.path)}
              >
                {c.labelZh || c.labelEn || c.path.split(/[./]/).pop()}
              </button>
            </span>
          ))}
        </nav>
        <code className='is-size-7'>{tag.categoryPath}</code>
        {own && (
          <p className='has-text-grey'>
            本分类 {tag.categoryOwnCount} 个标签{' '}
            <button
              type='button'
              className='button is-text is-small p-0'
              onClick={() => openBrowse(own.path)}
            >
              浏览 →
            </button>
          </p>
        )}
      </DetailRow>

      {inspect.hit && (
        <DetailRow label='依据'>
          <span className='tag is-light mr-1'>
            {TEXT_MATCH_TIER_LABEL[inspect.hit.tier]}
          </span>
          {evidenceText(inspect.hit)}
        </DetailRow>
      )}

      {tag.aliases.length > 0 && (
        <DetailRow label='别名／译名'>{tag.aliases.join('、')}</DetailRow>
      )}

      {tag.notes && <DetailRow label='说明'>{tag.notes}</DetailRow>}

      <DetailRow label='来源'>
        <ul>
          {tag.sourceRecords.map((r) => (
            <li key={`${r.source}:${r.key}`}>
              <span className='has-text-weight-semibold'>{r.source}</span>{' '}
              <code>{r.key}</code>
            </li>
          ))}
        </ul>
      </DetailRow>

      {browse && (
        <CategoryBrowse
          key={browse}
          path={browse}
          picked={picked}
          onToggle={props.onToggle}
          onOpen={props.onOpen}
          onClose={() => setBrowse(null)}
        />
      )}
    </div>
  )
}

function DetailRow(props: { label: string; children: ReactNode }) {
  return (
    <div className='is-size-7 mb-2'>
      <p className='has-text-grey'>{props.label}</p>
      <div>{props.children}</div>
    </div>
  )
}

// 详情栏里浏览一个分类（含子分类）的标签：点名称选择 / 取消，点 ⓘ 查看那个标签
function CategoryBrowse(props: {
  path: string
  picked: string[]
  onToggle: (canonical: string) => void
  onOpen: (canonical: string) => void
  onClose: () => void
}) {
  const [limit, setLimit] = useState(BROWSE_PAGE)
  const page = useQuery({
    queryKey: keys.category(props.path, limit),
    queryFn: () =>
      parseResponse(
        api.catalog.category.$get({
          query: { path: props.path, limit: String(limit) },
        }),
      ),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  })
  const data = page.data?.verified ? page.data : null
  return (
    <div className='tagloom-text-match-browse mt-3 pt-3'>
      <div className='is-flex is-justify-content-space-between is-align-items-center mb-2'>
        <p className='is-size-7 has-text-weight-semibold'>
          {data?.category?.labelZh || props.path}
          {data && `（${data.total}）`}
        </p>
        <button
          type='button'
          className='button is-small'
          onClick={props.onClose}
        >
          收起
        </button>
      </div>
      {page.error && <ErrorNotice error={apiErrorOf(page.error)} />}
      {!page.data && <Loading />}
      {data && (
        <>
          <div className='tagloom-text-match-list'>
            {data.tags.map((t) => {
              const on = props.picked.includes(t.canonical)
              return (
                <span key={t.canonical} className='tagloom-text-match-item'>
                  <button
                    type='button'
                    className={`tagloom-text-match-tag button is-small${
                      on ? ' is-primary' : ''
                    }`}
                    aria-pressed={on}
                    title={`${t.canonical} · 频次 ${t.postCount.toLocaleString()}`}
                    onClick={() =>
                      props.onToggle(t.canonical)}
                  >
                    <span aria-hidden='true' className='mr-1'>
                      {on ? '✓' : '+'}
                    </span>
                    {t.labelZh || t.canonical}
                  </button>
                  <button
                    type='button'
                    className='button is-small'
                    aria-label={`查看 ${t.canonical} 的详情`}
                    onClick={() =>
                      props.onOpen(t.canonical)}
                  >
                    ⓘ
                  </button>
                </span>
              )
            })}
          </div>
          {data.total > data.tags.length && (
            <button
              type='button'
              className={`button is-small is-text mt-2${
                page.isFetching ? ' is-loading' : ''
              }`}
              onClick={() => setLimit(limit + BROWSE_PAGE)}
            >
              再显示 {Math.min(BROWSE_PAGE, data.total - data.tags.length)} 个
            </button>
          )}
        </>
      )}
    </div>
  )
}
