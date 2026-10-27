// 人物编辑：角色档案 → 共享 Base（头发 → 眼睛 → 身形 → 其他）→ 造型组合（服装分类 + 底部发型覆盖）→ 预览 / 导出。
// 整份人物在本地编辑，点「保存」时带版本号提交；冲突时保留本地内容并提供重新加载。
// 冲突提示只提示，不阻止保存、复制或导出。
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearch } from 'wouter'
import {
  addCustomTag,
  applyAgentChanges,
  assembleCombo,
  BASE_SEGMENTS,
  buildCharacterBundle,
  type Character,
  type CharacterContent,
  type CharacterState,
  cloneSegment,
  collectNotices,
  type Combo,
  COMBO_SEGMENTS,
  type ComboSegmentKey,
  contentOf,
  createCustomTag,
  type CustomTag,
  type CustomTagInput,
  customTagUsage,
  displayTitle,
  duplicateCombo,
  emptyCombo,
  HAIR_OVERRIDE_SEGMENT,
  hasComboContent,
  hasSegmentContent,
  nameOf,
  negativeText,
  parentOf,
  pickCatalogTag,
  type Segment,
  segmentText,
  tagRefOf,
  type TagTarget,
} from '@app/tagloom/share'
import {
  api,
  type ApiError,
  apiErrorOf,
  exportOutputUrl,
  exportProjectUrl,
  folderHref,
  keys,
  parseResponse,
} from '../api.ts'
import {
  BottomSheet,
  ConfirmModal,
  ErrorNotice,
  Loading,
  PreviewBlock,
  useBarHeight,
  useTitle,
  useUnsavedGuard,
} from '../components/common.tsx'
import { CatalogBanner } from '../components/CatalogBanner.tsx'
import {
  GlobalTagSearch,
  type ResolveTarget,
} from '../components/GlobalTagSearch.tsx'
import { SegmentEditor } from '../components/SegmentEditor.tsx'
import { CustomTagLibrary } from '../components/CustomTagLibrary.tsx'
import { ContentBadge, Section } from '../components/Section.tsx'
import { SectionNav, type SectionNavItem } from '../components/SectionNav.tsx'
import { ItemLayoutSwitch } from '../components/ItemLayoutSwitch.tsx'
import { useHandoffSend } from '../components/HandoffSend.tsx'
import {
  type ReportInvalid,
  SeedField,
  StateEditor,
  StateList,
} from '../components/StateEditor.tsx'
import {
  addState,
  duplicateStateIn,
  removeStateFrom,
  updateStateIn,
} from '../components/state-ui.ts'

export default function CharacterEdit() {
  // 人物以文件路径区分（/tagloom/edit?path=漫画A/艾莉丝.json）
  const path = new URLSearchParams(useSearch()).get('path') ?? ''
  const folder = parentOf(path)
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: keys.character(path),
    queryFn: () => parseResponse(api.characters.item.$get({ query: { path } })),
  })
  const [draft, setDraft] = useState<CharacterContent | null>(null)
  const [version, setVersion] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [comboId, setComboId] = useState<string | null>(null)
  // AI 追加的提示（合并到编辑内容后显示）；otherEdit：别处有不只是 AI 追加的修改
  const [agentInfo, setAgentInfo] = useState<string | null>(null)
  const [otherEdit, setOtherEdit] = useState(false)
  // 当前选中的状态（属于当前组合）；种子等数值输入的非法状态（有任何一项即禁止保存）
  const [stateId, setStateId] = useState<string | null>(null)
  const handoff = useHandoffSend()
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const [epoch, setEpoch] = useState(0)
  const reportInvalid = useCallback<ReportInvalid>((key, err) => {
    setInvalid((cur) => {
      if (err === null) {
        if (!(key in cur)) return cur
        const { [key]: _drop, ...rest } = cur
        return rest
      }
      return cur[key] === err ? cur : { ...cur, [key]: err }
    })
  }, [])
  const invalidCount = Object.keys(invalid).length

  useEffect(() => {
    if (query.data && draft === null) {
      setDraft(contentOf(query.data))
      setVersion(query.data.version)
    }
  }, [query.data, draft])

  // 定时（以及切回页面时）拉取 AI 追加，合并进正在编辑的内容，并把基准版本前移；
  // 之后你删掉的 AI 条目，保存时不会再被合并回来
  const agentChanges = useQuery({
    queryKey: keys.agentChanges(path, version),
    queryFn: () =>
      parseResponse(
        api.characters.item['agent-changes'].$get({
          query: { path, since: String(version) },
        }),
      ),
    enabled: draft !== null && version > 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })
  useEffect(() => {
    const data = agentChanges.data
    if (!data || data.version <= version) return
    if (data.conflict) {
      setOtherEdit(true)
      return
    }
    const pending = data.changes
    setDraft((d) => (d ? applyAgentChanges(d, pending).content : d))
    setVersion(data.version)
    const tags = pending.reduce((n, ch) => n + ch.tags.length, 0)
    const items = pending.reduce((n, ch) => n + ch.items.length, 0)
    const names = [...new Set(pending.map((ch) => ch.agentName))].join('、')
    setAgentInfo(
      `🤖 AI（${names}）新增了 ${tags} 个标签、${items} 个条目，已合并到当前编辑内容`,
    )
  }, [agentChanges.data])

  // 关闭 / 刷新页面和站内跳转都会提醒未保存的修改
  const unsavedGuard = useUnsavedGuard(dirty || invalidCount > 0)

  useTitle(draft ? displayTitle(draft) : '人物')

  const save = useMutation({
    mutationFn: (content: CharacterContent) =>
      parseResponse(
        api.characters.item.$put({
          query: { path },
          json: { expectedVersion: version, content },
        }),
      ),
    onSuccess: (c) => {
      setVersion(c.version)
      // 保存前服务端合并了还没拉取到的 AI 追加：以返回内容为准
      if (c.agentMerged) {
        setDraft(contentOf(c))
        setAgentInfo(
          `保存时合并了 AI 新增的 ${c.agentMerged.tags} 个标签、${c.agentMerged.items} 个条目`,
        )
      }
      setOtherEdit(false)
      setDirty(false)
      setError(null)
      qc.setQueryData(keys.character(path), c)
      qc.invalidateQueries({ queryKey: keys.list })
    },
    onError: (e) => setError(apiErrorOf(e)),
  })

  // 文件在编辑期间被移动、改名或删除：保存会报 not_found（服务端不会在原位置悄悄新建）。
  // 用户确认后，把当前内容作为新文件保存到原位置。
  const saveAsNew = useMutation({
    mutationFn: (content: CharacterContent) =>
      parseResponse(api.characters.$post({ json: { path, content } })),
    onSuccess: (c) => {
      setVersion(c.version)
      setOtherEdit(false)
      setDirty(false)
      setError(null)
      qc.setQueryData(keys.character(path), c)
      qc.invalidateQueries({ queryKey: keys.list })
    },
    onError: (e) => setError(apiErrorOf(e)),
  })

  async function reload() {
    const fresh = await query.refetch()
    if (fresh.data) {
      setDraft(contentOf(fresh.data))
      setVersion(fresh.data.version)
      setDirty(false)
      setError(null)
      setOtherEdit(false)
      setEpoch((n) => n + 1)
    }
  }

  const notices = useMemo(() => (draft ? collectNotices(draft) : []), [draft])

  // Ctrl+S / Cmd+S 保存（没有修改或有无效输入时只拦下浏览器的“另存网页”）
  const saveShortcut = useRef<() => void>(() => {})
  saveShortcut.current = () => {
    if (draft && dirty && invalidCount === 0 && !save.isPending) {
      save.mutate(draft)
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's'
      ) {
        e.preventDefault()
        saveShortcut.current()
      }
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [])

  const setBar = useBarHeight()

  const [previewOpen, setPreviewOpen] = useState(false)
  const closePreview = useCallback(() => setPreviewOpen(false), [])

  if (query.isPending) return <Loading />
  if (query.error) {
    return (
      <>
        <ErrorNotice error={apiErrorOf(query.error)} />
        <Link href={folderHref(folder)} className='button'>返回列表</Link>
      </>
    )
  }
  if (!draft) return <Loading />

  const update = (fn: (c: CharacterContent) => CharacterContent) => {
    setDraft((c) => (c ? fn(c) : c))
    setDirty(true)
  }
  const combo = draft.combos.find((c) => c.id === comboId) ?? draft.combos[0] ??
    null
  // 角色标签库：在选词区新建的自创标签记为人工创建
  const lib: TagLib = {
    customTags: draft.customTags,
    onCreateCustomTag: (input) => {
      const tag = createCustomTag(input, { origin: 'user' })
      update((c) => addCustomTag(c, tag))
      return tag
    },
  }
  const updateCombo = (cid: string, fn: (c: Combo) => Combo) =>
    update((c) => ({
      ...c,
      combos: c.combos.map((x) => (x.id === cid ? fn(x) : x)),
    }))
  const selectedState = combo?.states.find((s) => s.id === stateId) ?? null

  // 全局标签搜索的目标分类：Base 共享；组合 / 状态分类指当前选中的组合 / 状态
  const resolveTarget: ResolveTarget = (t) => {
    if (t.scope === 'base') {
      return draft.base.segments[t.segment as keyof typeof draft.base.segments]
    }
    if (!combo) return '先新建造型组合'
    if (t.scope === 'costume') {
      return combo.segments[t.segment as ComboSegmentKey]
    }
    if (!selectedState) return '先选择角色状态'
    return selectedState[t.segment as 'expression' | 'action']
  }
  const applyToTarget = (t: TagTarget, fn: (s: Segment) => Segment) => {
    if (t.scope === 'base') {
      const key = t.segment as keyof typeof draft.base.segments
      update((c) => ({
        ...c,
        base: {
          ...c.base,
          segments: { ...c.base.segments, [key]: fn(c.base.segments[key]) },
        },
      }))
    } else if (combo && t.scope === 'costume') {
      const key = t.segment as ComboSegmentKey
      updateCombo(combo.id, (c) => ({
        ...c,
        segments: { ...c.segments, [key]: fn(c.segments[key]) },
      }))
    } else if (combo && selectedState) {
      const key = t.segment as 'expression' | 'action'
      updateCombo(
        combo.id,
        (c) =>
          updateStateIn(c, selectedState.id, (s) => ({
            ...s,
            [key]: fn(s[key]),
          })),
      )
    }
  }

  return (
    <>
      <div className='action-bar is-top mb-4 tagloom-editbar' ref={setBar}>
        <div className='tagloom-editbar-row'>
          <Link
            href={folderHref(folder)}
            className='button is-text px-2'
            aria-label={`返回人物列表：${folder || '根目录'}`}
            title={`文件：${path}`}
          >
            ←<span className='is-hidden-mobile ml-1'>
              {folder ? nameOf(folder) : '人物列表'}
            </span>
          </Link>
          <input
            className='input has-text-weight-semibold tagloom-editbar-title'
            aria-label='人物名'
            placeholder='人物名（可空，列表中默认显示档案第一行）'
            value={draft.title}
            onChange={(e) => {
              const v = e.target.value
              update((c) => ({ ...c, title: v }))
            }}
          />
          <ItemLayoutSwitch />
          {/* 窄屏不单独显示状态：保存按钮本身显示“保存 / 已保存” */}
          <span
            className='is-size-7 has-text-grey text-nowrap is-hidden-mobile'
            role='status'
          >
            {dirty || invalidCount > 0
              ? '有未保存的修改'
              : `已保存 · 版本 ${version}`}
          </span>
          <button
            type='button'
            className={`button is-primary${
              save.isPending ? ' is-loading' : ''
            }`}
            disabled={!dirty || invalidCount > 0}
            title='保存（Ctrl+S）'
            aria-keyshortcuts='Control+S Meta+S'
            onClick={() => save.mutate(draft)}
          >
            {!dirty && invalidCount === 0 && (
              <span className='is-hidden-tablet'>已</span>
            )}
            保存
          </button>
          <ExportMenu
            path={path}
            dirty={dirty}
            // 当前选中的组合 + 状态；没有组合时不能发送
            onSend={combo
              ? () => {
                const bundle = buildCharacterBundle(
                  draft,
                  combo.id,
                  selectedState?.id ?? null,
                )
                if (bundle) handoff.send(bundle)
              }
              : null}
          />
        </div>
        {invalidCount > 0 && (
          <p className='is-size-7 has-text-danger mt-1' role='alert'>
            {invalidCount} 处数值输入无效，修正后才能保存
          </p>
        )}
        <div className='tagloom-editbar-row mt-2'>
          <SectionNav items={navItems(draft, combo)} />
          <GlobalTagSearch
            resolve={resolveTarget}
            onAdd={(t, tag, catalogVersion) =>
              applyToTarget(
                t,
                (s) =>
                  pickCatalogTag(s, t.field, tagRefOf(tag, catalogVersion)),
              )}
          />
        </div>
      </div>

      {unsavedGuard}
      {agentInfo && (
        <div className='notification is-info is-light' role='status'>
          <button
            type='button'
            className='delete'
            aria-label='关闭提示'
            onClick={() =>
              setAgentInfo(null)}
          />
          {agentInfo}
        </div>
      )}
      {otherEdit && (
        <div className='notification is-warning is-light' role='status'>
          这个人物在别处被修改过（不只是 AI 追加），现在保存会冲突。
          <button
            type='button'
            className='button is-small ml-2'
            onClick={reload}
          >
            重新加载（放弃本地修改）
          </button>
        </div>
      )}
      {handoff.notice}
      <CatalogBanner />
      <ErrorNotice
        error={error}
        onClose={() => setError(null)}
        action={error?.code === 'version_conflict'
          ? (
            <button type='button' className='button is-small' onClick={reload}>
              重新加载（放弃本地修改）
            </button>
          )
          : error?.code === 'not_found' && (
            <>
              <p className='mb-2'>
                文件 {path}{' '}
                可能已在别处被移动、改名或删除。可以把当前内容保存为原位置的新文件，或返回列表找到它的新位置。
              </p>
              <button
                type='button'
                className={`button is-small${
                  saveAsNew.isPending ? ' is-loading' : ''
                }`}
                disabled={invalidCount > 0}
                onClick={() => saveAsNew.mutate(draft)}
              >
                保存到原位置（新文件）
              </button>
            </>
          )}
      />

      <div className='columns' key={epoch}>
        <div className='column is-8'>
          <Section
            anchor='sec-style'
            title='画风串'
            hasContent={draft.stylePrompt.trim().length > 0}
            defaultOpen={false}
          >
            <textarea
              className='textarea'
              rows={3}
              aria-label='画风串'
              aria-describedby='tagloom-style-help'
              placeholder='手写画风、画师标签等，格式自定。'
              maxLength={200_000}
              value={draft.stylePrompt}
              onChange={(e) => {
                const v = e.target.value
                update((c) => ({ ...c, stylePrompt: v }))
              }}
            />
            <p id='tagloom-style-help' className='help'>
              随人物保存和人物存档导入导出；仅记录原文，不自动拼入角色 Prompt。
            </p>
          </Section>
          <Section
            anchor='sec-negative'
            title='负面 Prompt'
            hasContent={draft.negativePrompt.trim().length > 0}
            defaultOpen={false}
          >
            <textarea
              className='textarea'
              rows={3}
              aria-label='负面 Prompt'
              aria-describedby='tagloom-negative-help'
              placeholder='希望避免出现的内容，如 lowres, bad hands, extra fingers'
              maxLength={200_000}
              value={draft.negativePrompt}
              onChange={(e) => {
                const v = e.target.value
                update((c) => ({ ...c, negativePrompt: v }))
              }}
            />
            <p id='tagloom-negative-help' className='help'>
              手写原文、不分类，所有造型组合和状态共用；导出成品时作为负面提示词原样输出（只去掉首尾的空白和逗号）。
            </p>
          </Section>
          <Section
            anchor='sec-profile'
            title='角色档案'
            hasContent={draft.profile.trim().length > 0}
            defaultOpen
          >
            <textarea
              className='textarea'
              rows={5}
              aria-label='角色档案'
              placeholder='自由文本，格式自定。只存档：不自动解析、不改写 Base、不进入 Prompt。'
              value={draft.profile}
              onChange={(e) => {
                const v = e.target.value
                update((c) => ({ ...c, profile: v }))
              }}
            />
          </Section>
          <div className='box p-3 mb-3'>
            <SeedField
              id='tagloom-character-seed'
              label='人物默认种子（可选）'
              value={draft.seed}
              allowEmpty
              reportInvalid={reportInvalid}
              help='留空表示没有默认种子；状态可沿用它或单独指定。0 是有效种子。'
              onCommit={(v) => update((c) => {
                const { seed: _drop, ...rest } = c
                return v === undefined ? rest : { ...rest, seed: v }
              })}
            />
          </div>
          <Section
            anchor='sec-custom-tags'
            title={`角色标签库（${draft.customTags.length}）`}
            hasContent={draft.customTags.length > 0}
            defaultOpen={false}
          >
            <CustomTagLibrary
              content={draft}
              usage={customTagUsage(draft)}
              onChange={update}
            />
          </Section>

          <h2
            id='sec-base'
            tabIndex={-1}
            className='title is-5 mt-5 tagloom-anchor'
          >
            Base 固定外貌（共享）
          </h2>
          <div className='field is-horizontal'>
            <div className='field-label is-small'>
              <label className='label' htmlFor='tagloom-subject'>
                主体类型
                <ContentBadge filled={draft.base.subject.trim().length > 0} />
              </label>
            </div>
            <div className='field-body'>
              <input
                id='tagloom-subject'
                className='input is-small'
                placeholder='可选，如 1girl；单独导出，不混入身形，不计入完整角色 Prompt'
                value={draft.base.subject}
                onChange={(e) => {
                  const v = e.target.value
                  update((c) => ({ ...c, base: { ...c.base, subject: v } }))
                }}
              />
            </div>
          </div>
          {BASE_SEGMENTS.map((def) => (
            <Section
              key={def.key}
              anchor={`sec-base-${def.key}`}
              title={def.label}
              hasContent={hasSegmentContent(draft.base.segments[def.key])}
              defaultOpen={!def.collapsed}
            >
              <SegmentEditor
                def={def}
                segment={draft.base.segments[def.key]}
                profile={draft.profile}
                {...lib}
                hint={def.key === 'hair'
                  ? '发色、发型选词都加入这一段；头发只输出这一段'
                  : undefined}
                onChange={(fn) =>
                  update((c) => ({
                    ...c,
                    base: {
                      ...c.base,
                      segments: {
                        ...c.base.segments,
                        [def.key]: fn(c.base.segments[def.key]),
                      },
                    },
                  }))}
              />
            </Section>
          ))}

          <h2
            id='sec-combos'
            tabIndex={-1}
            className='title is-5 mt-5 tagloom-anchor'
          >
            造型组合
          </h2>
          <ComboTabs
            combos={draft.combos}
            current={combo}
            onSelect={setComboId}
            onAdd={() => {
              const n = emptyCombo(`组合 ${draft.combos.length + 1}`)
              update((c) => ({ ...c, combos: [...c.combos, n] }))
              setComboId(n.id)
            }}
            onDuplicate={(src) => {
              const n = duplicateCombo(src, `${src.name || '组合'} 副本`)
              update((c) => ({ ...c, combos: [...c.combos, n] }))
              setComboId(n.id)
            }}
            onRemove={(cid) => {
              update((c) => ({
                ...c,
                combos: c.combos.filter((x) => x.id !== cid),
              }))
              setComboId(null)
            }}
          />
          {combo && (
            <ComboEditor
              key={combo.id}
              combo={combo}
              base={draft.base}
              characterSeed={draft.seed}
              profile={draft.profile}
              lib={lib}
              stateId={stateId}
              onSelectState={setStateId}
              reportInvalid={reportInvalid}
              onChange={(fn) => updateCombo(combo.id, fn)}
            />
          )}
        </div>

        <div className='column is-4 is-hidden-mobile'>
          <Preview
            draft={draft}
            combo={combo}
            state={selectedState}
            notices={notices}
          />
        </div>
      </div>

      {/* 窄屏：预览不放在页面最底部，改为底部按钮 + 底部弹出面板 */}
      <div className='tagloom-fab-spacer is-hidden-tablet' aria-hidden='true' />
      <button
        type='button'
        className='button is-link tagloom-preview-fab is-hidden-tablet'
        aria-haspopup='dialog'
        onClick={() => setPreviewOpen(true)}
      >
        预览 Prompt{notices.length > 0 ? `（${notices.length} 个提示）` : ''}
      </button>
      <BottomSheet
        title='预览 Prompt'
        open={previewOpen}
        onClose={closePreview}
      >
        <Preview
          draft={draft}
          combo={combo}
          state={selectedState}
          notices={notices}
        />
      </BottomSheet>
    </>
  )
}

// 目录：顶层分类 + 当前组合的服装分类；「更多服装分类」里的子分类跳到它们的外层
function navItems(
  draft: CharacterContent,
  combo: Combo | null,
): SectionNavItem[] {
  const items: SectionNavItem[] = [
    {
      anchor: 'sec-style',
      label: '画风串',
      hasContent: draft.stylePrompt.trim().length > 0,
    },
    {
      anchor: 'sec-negative',
      label: '负面 Prompt',
      hasContent: draft.negativePrompt.trim().length > 0,
    },
    {
      anchor: 'sec-profile',
      label: '角色档案',
      hasContent: draft.profile.trim().length > 0,
    },
    {
      anchor: 'sec-custom-tags',
      label: '角色标签库',
      hasContent: draft.customTags.length > 0,
    },
    { anchor: 'sec-base', label: 'Base 固定外貌' },
    ...BASE_SEGMENTS.map((def) => ({
      anchor: `sec-base-${def.key}`,
      label: def.label,
      hasContent: hasSegmentContent(draft.base.segments[def.key]),
      nested: true,
    })),
    {
      anchor: 'sec-combos',
      label: combo ? `造型组合 · ${combo.name || '未命名组合'}` : '造型组合',
    },
  ]
  if (!combo) return items
  const more = COMBO_SEGMENTS.filter((d) => d.collapsed)
  return [
    ...items,
    ...COMBO_SEGMENTS.filter((d) => !d.collapsed).map((def) => ({
      anchor: `sec-costume-${def.key}`,
      label: def.label,
      hasContent: hasSegmentContent(combo.segments[def.key]),
      nested: true,
    })),
    {
      anchor: 'sec-costume-more',
      label: '更多服装分类',
      hasContent: more.some((d) => hasSegmentContent(combo.segments[d.key])),
      nested: true,
    },
    {
      anchor: 'sec-hair-override',
      label: '发型覆盖',
      hasContent: hasSegmentContent(combo.hairOverride.segment),
      nested: true,
    },
    {
      anchor: 'sec-states',
      label: '角色状态',
      hasContent: (combo.states ?? []).length > 0,
      nested: true,
    },
  ]
}

function ComboTabs(props: {
  combos: Combo[]
  current: Combo | null
  onSelect: (id: string) => void
  onAdd: () => void
  onDuplicate: (c: Combo) => void
  onRemove: (id: string) => void
}) {
  const [removing, setRemoving] = useState<Combo | null>(null)
  return (
    <>
      <div className='tabs is-boxed mb-0'>
        <ul>
          {props.combos.map((c) => (
            <li
              key={c.id}
              className={c.id === props.current?.id ? 'is-active' : ''}
            >
              <a
                href='#'
                aria-current={c.id === props.current?.id ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  props.onSelect(c.id)
                }}
              >
                {c.name || '未命名组合'}
                <ContentBadge filled={hasComboContent(c)} />
                {c.hairOverride.enabled && (
                  <span className='tag is-info is-light'>发型覆盖</span>
                )}
              </a>
            </li>
          ))}
          <li>
            <a
              href='#'
              onClick={(e) => {
                e.preventDefault()
                props.onAdd()
              }}
            >
              ＋ 新组合
            </a>
          </li>
        </ul>
      </div>
      {props.current && (
        <div className='buttons are-small mt-2 mb-2'>
          <button
            type='button'
            className='button'
            onClick={() => props.onDuplicate(props.current!)}
          >
            复制当前组合
          </button>
          <button
            type='button'
            className='button is-danger is-outlined'
            onClick={() => setRemoving(props.current)}
          >
            删除当前组合
          </button>
        </div>
      )}
      <ConfirmModal
        open={removing !== null}
        title={`删除组合「${removing?.name || '未命名组合'}」？`}
        confirmLabel='删除'
        onConfirm={() => {
          if (removing) props.onRemove(removing.id)
          setRemoving(null)
        }}
        onCancel={() => setRemoving(null)}
      >
        只删除这个组合，不影响共享 Base
        和其他组合。保存前可以通过「重新加载」恢复。
      </ConfirmModal>
    </>
  )
}

// 角色标签库（传给每个分类的选词区）
interface TagLib {
  customTags: CustomTag[]
  onCreateCustomTag: (input: CustomTagInput) => CustomTag
}

function ComboEditor(props: {
  combo: Combo
  base: CharacterContent['base']
  characterSeed: number | undefined
  profile: string
  lib: TagLib
  stateId: string | null
  onSelectState: (id: string | null) => void
  reportInvalid: ReportInvalid
  onChange: (fn: (c: Combo) => Combo) => void
}) {
  const { combo, onChange } = props
  const baseHair = props.base.segments.hair
  const [removingState, setRemovingState] = useState(false)
  const states = combo.states ?? []
  const selectedState = states.find((s) => s.id === props.stateId) ?? null
  const seg = (key: ComboSegmentKey) => (fn: (s: Segment) => Segment) =>
    onChange((c) => ({
      ...c,
      segments: { ...c.segments, [key]: fn(c.segments[key]) },
    }))
  const visible = COMBO_SEGMENTS.filter((d) => !d.collapsed)
  const more = COMBO_SEGMENTS.filter((d) => d.collapsed)

  return (
    <div>
      <div className='field'>
        <label className='label is-small' htmlFor={`combo-name-${combo.id}`}>
          场合名称
          <ContentBadge filled={combo.name.trim().length > 0} />
        </label>
        <input
          id={`combo-name-${combo.id}`}
          className='input is-small'
          placeholder='如：日常、运动、泳装（可空）'
          value={combo.name}
          onChange={(e) => {
            const v = e.target.value
            onChange((c) => ({ ...c, name: v }))
          }}
        />
      </div>
      {visible.map((def) => (
        <Section
          key={def.key}
          anchor={`sec-costume-${def.key}`}
          title={def.label}
          hasContent={hasSegmentContent(combo.segments[def.key])}
          defaultOpen={def.key === 'overall' ||
            hasSegmentContent(combo.segments[def.key])}
        >
          <SegmentEditor
            def={def}
            segment={combo.segments[def.key]}
            profile={props.profile}
            {...props.lib}
            hint={def.key === 'overall'
              ? '原型、整体样式、特殊结构；输出时自动与其他服装分类拼接'
              : undefined}
            onChange={seg(def.key)}
          />
        </Section>
      ))}
      <Section
        anchor='sec-costume-more'
        title='更多服装分类（整件／连体、内衣、贴身层）'
        hasContent={more.some((def) =>
          hasSegmentContent(combo.segments[def.key])
        )}
        defaultOpen={more.some((def) =>
          hasSegmentContent(combo.segments[def.key])
        )}
      >
        {more.map((def) => (
          <Section
            key={def.key}
            title={def.label}
            hasContent={hasSegmentContent(combo.segments[def.key])}
            defaultOpen={hasSegmentContent(combo.segments[def.key])}
          >
            <SegmentEditor
              def={def}
              segment={combo.segments[def.key]}
              profile={props.profile}
              {...props.lib}
              onChange={seg(def.key)}
            />
          </Section>
        ))}
      </Section>

      {/* 发型覆盖：记录状态与是否启用分别显示。 */}
      <Section
        anchor='sec-hair-override'
        title={`发型覆盖（低频，可选） · ${
          combo.hairOverride.enabled ? '已启用' : '未启用'
        }`}
        hasContent={hasSegmentContent(combo.hairOverride.segment)}
        defaultOpen={combo.hairOverride.enabled}
      >
        <label className='checkbox mb-2'>
          <input
            type='checkbox'
            className='mr-2'
            checked={combo.hairOverride.enabled}
            onChange={(e) => {
              const enabled = e.target.checked
              onChange((c) => ({
                ...c,
                hairOverride: { ...c.hairOverride, enabled },
              }))
            }}
          />
          启用：本组合的头发段直接使用下面的覆盖表达（不叠加 Base
          头发，不改写共享 Base 或其他组合）
        </label>
        <p className='is-size-7 has-text-grey mb-2'>
          需要保留的发色、长度、刘海等请在覆盖段里自行写全；工具不做细项继承。
          {segmentText(baseHair) && (
            <button
              type='button'
              className='button is-small is-text'
              onClick={() =>
                onChange((c) => ({
                  ...c,
                  hairOverride: {
                    ...c.hairOverride,
                    // 条目及事实一起复制并重建引用，之后两边各改各的。
                    segment: cloneSegment(baseHair),
                  },
                }))}
            >
              用 Base 头发段作为起点
            </button>
          )}
        </p>
        {combo.hairOverride.enabled && (
          <SegmentEditor
            def={HAIR_OVERRIDE_SEGMENT}
            segment={combo.hairOverride.segment}
            profile={props.profile}
            {...props.lib}
            onChange={(fn) =>
              onChange((c) => ({
                ...c,
                hairOverride: {
                  ...c.hairOverride,
                  segment: fn(c.hairOverride.segment),
                },
              }))}
          />
        )}
      </Section>

      <h3
        id='sec-states'
        tabIndex={-1}
        className='title is-5 mt-5 tagloom-anchor'
      >
        角色状态
      </h3>
      <StateList
        states={states}
        selectedId={selectedState?.id ?? null}
        onSelect={props.onSelectState}
        onAdd={() => {
          const r = addState(combo)
          onChange((c) => ({ ...c, states: [...(c.states ?? []), r.state] }))
          props.onSelectState(r.state.id)
        }}
        onDuplicate={() => {
          if (!selectedState) return
          const r = duplicateStateIn(combo, selectedState.id)
          if (!r) return
          onChange((c) => {
            const index = c.states.findIndex((s) => s.id === selectedState.id)
            if (index < 0) return c
            const next = [...c.states]
            next.splice(index + 1, 0, r.state)
            return { ...c, states: next }
          })
          props.onSelectState(r.state.id)
        }}
        onRemove={() => setRemovingState(true)}
      />
      {selectedState && (
        <StateEditor
          key={selectedState.id}
          state={selectedState}
          combo={combo}
          base={props.base}
          characterSeed={props.characterSeed}
          profile={props.profile}
          lib={props.lib}
          reportInvalid={props.reportInvalid}
          onChange={(fn) =>
            onChange((c) => updateStateIn(c, selectedState.id, fn))}
        />
      )}
      <ConfirmModal
        open={removingState}
        title={`删除状态「${selectedState?.name || '未命名状态'}」？`}
        confirmLabel='删除'
        onConfirm={() => {
          if (selectedState) {
            const id = selectedState.id
            onChange((c) => removeStateFrom(c, id))
            props.onSelectState(null)
          }
          setRemovingState(false)
        }}
        onCancel={() => setRemovingState(false)}
      >
        只删除这个状态及其表情、动作和造型调整，不影响组合和共享 Base。
      </ConfirmModal>
    </div>
  )
}

function Preview(props: {
  draft: CharacterContent
  combo: Combo | null
  state: CharacterState | null
  notices: ReturnType<typeof collectNotices>
}) {
  const { draft, combo, notices, state } = props
  const a = combo ? assembleCombo(draft, combo) : null
  const sa = combo && state ? assembleCombo(draft, combo, state) : null
  return (
    <div className='tagloom-preview'>
      <div className='box'>
        <p className='title is-6 mb-2'>
          预览 · {combo ? combo.name || '未命名组合' : '无组合'}
        </p>
        {a
          ? (
            <>
              <PreviewBlock
                label={`有效 Base${
                  a.hairSource === 'override' ? '（头发：组合覆盖）' : ''
                }`}
                text={a.base}
              />
              <PreviewBlock label='服装 Prompt' text={a.costume} />
              <PreviewBlock label='完整角色 Prompt' text={a.full} strong />
              <PreviewBlock label='负面 Prompt' text={negativeText(draft)} />
              {draft.base.subject.trim() && (
                <p className='is-size-7 has-text-grey'>
                  主体类型 {draft.base.subject.trim()}{' '}
                  单独导出，未计入上面的 Prompt。
                </p>
              )}
            </>
          )
          : (
            <p className='has-text-grey'>
              新建一个造型组合后显示完整 Prompt。
            </p>
          )}
      </div>
      {sa?.state && (
        <div className='box'>
          <p className='title is-6 mb-2'>
            状态预览 · {state?.name || '未命名状态'}
          </p>
          <PreviewBlock label='状态完整 Prompt' text={sa.full} strong />
          <p className='is-size-7'>
            有效种子：{sa.state.effectiveSeed === undefined
              ? '无（人物与状态均未设置）'
              : sa.state.effectiveSeed}
          </p>
        </div>
      )}
      <div className='box'>
        <p className='title is-6 mb-2'>提示（{notices.length}）</p>
        {notices.length === 0
          ? <p className='is-size-7 has-text-grey'>没有冲突或提示。</p>
          : (
            <ul className='is-size-7'>
              {notices.map((n, i) => (
                <li key={i} className='mb-1'>
                  <span
                    aria-hidden='true'
                    className='theme-warning-text mr-1'
                  >
                    ⚠
                  </span>
                  {n.message}
                </li>
              ))}
            </ul>
          )}
        <p className='is-size-7 has-text-grey mt-2'>
          提示不阻止保存、复制或导出，也不会自动修改内容。
        </p>
      </div>
    </div>
  )
}

function ExportMenu({ path, dirty, onSend }: {
  path: string
  dirty: boolean
  onSend: (() => void) | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`dropdown is-right${open ? ' is-active' : ''}`}>
      <div className='dropdown-trigger'>
        <button
          type='button'
          className='button'
          aria-haspopup='true'
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          导出 ▾
        </button>
      </div>
      <div className='dropdown-menu' role='menu'>
        <div className='dropdown-content'>
          <button
            type='button'
            className='dropdown-item button is-white is-fullwidth is-justify-content-flex-start'
            disabled={!onSend}
            title={onSend ? undefined : '先新建造型组合'}
            onClick={() => {
              onSend?.()
              setOpen(false)
            }}
          >
            发送到其他模块（当前组合 / 状态，作为一个角色）
          </button>
          <hr className='dropdown-divider' />
          {dirty && (
            <div className='dropdown-item is-size-7 theme-warning-text'>
              导出的是已保存的版本，请先保存。
            </div>
          )}
          <a
            className='dropdown-item'
            href={exportProjectUrl(path)}
            download
            onClick={() => setOpen(false)}
          >
            人物存档（可再导入）
          </a>
          <hr className='dropdown-divider' />
          <a
            className='dropdown-item'
            href={exportOutputUrl(path, 'json')}
            download
            onClick={() => setOpen(false)}
          >
            下游成品 · JSON
          </a>
          <a
            className='dropdown-item'
            href={exportOutputUrl(path, 'text')}
            download
            onClick={() => setOpen(false)}
          >
            下游成品 · 纯文本 Prompt
          </a>
        </div>
      </div>
    </div>
  )
}
