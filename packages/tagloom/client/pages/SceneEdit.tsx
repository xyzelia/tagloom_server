// 场景编辑：场景内容（不分类的条目）→ 人物槽位（快照 + 补充 + 位置）→ 负面 Prompt → 生成参数（可选）→ 场景标签库 → 预览 / 导出。
// 整份场景在本地编辑，点「保存」时带版本号提交；冲突时保留本地内容并提供重新加载。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearch } from 'wouter'
import {
  addCustomTag,
  buildPromptBundle,
  type CharacterSlot,
  cleanSceneParams,
  createCustomTag,
  type CustomTagInput,
  emptySlot,
  MAX_SCENE_SLOTS,
  nameOf,
  parentOf,
  replaceSnapshot,
  SCENE_PARAM_KEYS,
  type SceneContent,
  sceneContentOf,
  sceneCustomTagUsage,
  sceneDisplayTitle,
  sceneNegative,
  scenePrompt,
  type Segment,
  slotDisplayLabel,
  slotNegative,
  slotPrompt,
} from '@app/tagloom/share'
import {
  api,
  type ApiError,
  apiErrorOf,
  exportSceneUrl,
  keys,
  parseResponse,
  sceneFolderHref,
} from '../api.ts'
import {
  BottomSheet,
  ErrorNotice,
  Loading,
  PreviewBlock,
  useBarHeight,
  useTitle,
  useUnsavedGuard,
} from '../components/common.tsx'
import { CatalogBanner } from '../components/CatalogBanner.tsx'
import { CustomTagLibrary } from '../components/CustomTagLibrary.tsx'
import { PromptItemList } from '../components/PromptItemList.tsx'
import { SceneImport } from '../components/SceneImport.tsx'
import { ItemLayoutSwitch } from '../components/ItemLayoutSwitch.tsx'
import { HandoffIntoScene } from '../components/HandoffBanner.tsx'
import { useHandoffSend } from '../components/HandoffSend.tsx'
import {
  SceneParamsEditor,
  sceneParamsSummary,
} from '../components/SceneParamsEditor.tsx'
import type { ReportInvalid } from '../components/StateEditor.tsx'
import { SceneTagInput } from '../components/SceneTagInput.tsx'
import { Section } from '../components/Section.tsx'
import { SectionNav, type SectionNavItem } from '../components/SectionNav.tsx'
import { SlotEditor } from '../components/SlotEditor.tsx'
import { CharacterPicker } from '../components/CharacterPicker.tsx'

export default function SceneEdit() {
  const path = new URLSearchParams(useSearch()).get('path') ?? ''
  const folder = parentOf(path)
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: keys.scene(path),
    queryFn: () => parseResponse(api.scenes.item.$get({ query: { path } })),
  })
  const [draft, setDraft] = useState<SceneContent | null>(null)
  const [version, setVersion] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [picking, setPicking] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const handoff = useHandoffSend()
  const closePreview = useCallback(() => setPreviewOpen(false), [])
  // 数值输入的非法状态（有任何一项即禁止保存）
  const [invalid, setInvalid] = useState<Record<string, string>>({})
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
      setDraft(sceneContentOf(query.data))
      setVersion(query.data.version)
    }
  }, [query.data, draft])

  const unsavedGuard = useUnsavedGuard(dirty || invalidCount > 0, '场景')
  const setBar = useBarHeight()
  useTitle(draft ? sceneDisplayTitle(draft) : '场景')

  const saved = (s: { version: number }) => {
    setVersion(s.version)
    setDirty(false)
    setError(null)
    qc.setQueryData(keys.scene(path), s)
    qc.invalidateQueries({ queryKey: keys.sceneList })
  }
  const save = useMutation({
    mutationFn: (content: SceneContent) =>
      parseResponse(
        api.scenes.item.$put({
          query: { path },
          json: { expectedVersion: version, content },
        }),
      ),
    onSuccess: saved,
    onError: (e) => setError(apiErrorOf(e)),
  })
  // 文件在编辑期间被移动、改名或删除：用户确认后把当前内容保存为原位置的新文件
  const saveAsNew = useMutation({
    mutationFn: (content: SceneContent) =>
      parseResponse(api.scenes.$post({ json: { path, content } })),
    onSuccess: saved,
    onError: (e) => setError(apiErrorOf(e)),
  })

  async function reload() {
    const fresh = await query.refetch()
    if (fresh.data) {
      setDraft(sceneContentOf(fresh.data))
      setVersion(fresh.data.version)
      setDirty(false)
      setError(null)
      setEpoch((n) => n + 1)
    }
  }

  // Ctrl+S / Cmd+S 保存
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

  if (query.isPending) return <Loading />
  if (query.error) {
    return (
      <>
        <ErrorNotice noun='场景' error={apiErrorOf(query.error)} />
        <Link href={sceneFolderHref(folder)} className='button'>返回列表</Link>
      </>
    )
  }
  if (!draft) return <Loading />

  const update = (fn: (c: SceneContent) => SceneContent) => {
    setDraft((c) => (c ? fn(c) : c))
    setDirty(true)
  }
  const onCreateCustomTag = (input: CustomTagInput) => {
    // 场景的自创标签不分字段
    const tag = createCustomTag({ ...input, fields: [] }, { origin: 'user' })
    update((c) => addCustomTag(c, tag))
    return tag
  }
  const setContent = (fn: (seg: Segment) => Segment) =>
    update((c) => ({ ...c, content: fn(c.content) }))
  const updateSlot = (id: string, fn: (s: CharacterSlot) => CharacterSlot) =>
    update((c) => ({
      ...c,
      slots: c.slots.map((s) => (s.id === id ? fn(s) : s)),
    }))
  const moveSlot = (id: string, delta: number) =>
    update((c) => {
      const from = c.slots.findIndex((s) => s.id === id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= c.slots.length) return c
      const slots = [...c.slots]
      const [it] = slots.splice(from, 1)
      slots.splice(to, 0, it)
      return { ...c, slots }
    })
  const full = draft.slots.length >= MAX_SCENE_SLOTS
  const send = () => handoff.send(buildPromptBundle(draft))

  return (
    <>
      <div className='action-bar is-top mb-4 tagloom-editbar' ref={setBar}>
        <div className='tagloom-editbar-row'>
          <Link
            href={sceneFolderHref(folder)}
            className='button is-text px-2'
            aria-label={`返回场景列表：${folder || '根目录'}`}
            title={`文件：${path}`}
          >
            ←<span className='is-hidden-mobile ml-1'>
              {folder ? nameOf(folder) : '场景列表'}
            </span>
          </Link>
          <input
            className='input has-text-weight-semibold tagloom-editbar-title'
            aria-label='场景标题'
            placeholder='场景标题'
            value={draft.title}
            onChange={(e) => {
              const v = e.target.value
              update((c) => ({ ...c, title: v }))
            }}
          />
          <ItemLayoutSwitch />
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
          <ExportMenu path={path} dirty={dirty} onSend={send} />
        </div>
        <div className='tagloom-editbar-row mt-2'>
          <SectionNav items={navItems(draft)} />
          <SceneImport draft={draft} onApply={update} />
        </div>
        {invalidCount > 0 && (
          <p className='is-size-7 has-text-danger mt-1' role='alert'>
            {invalidCount} 处数值输入无效，修正后才能保存
          </p>
        )}
      </div>

      {unsavedGuard}
      {handoff.notice}
      <CatalogBanner />
      <ErrorNotice
        noun='场景'
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
                onClick={() => saveAsNew.mutate(draft)}
              >
                保存到原位置（新文件）
              </button>
            </>
          )}
      />

      <div className='columns' key={epoch}>
        <div className='column is-8'>
          <HandoffIntoScene draft={draft} onApply={update} />
          <Section
            title='备注'
            anchor='sec-note'
            hasContent={draft.note.trim().length > 0}
            defaultOpen={false}
          >
            <textarea
              className='textarea'
              rows={3}
              aria-label='场景备注'
              placeholder='只记录，不进入 Prompt'
              value={draft.note}
              onChange={(e) => {
                const v = e.target.value
                update((c) => ({ ...c, note: v }))
              }}
            />
          </Section>

          <Section
            title='场景内容'
            anchor='sec-content'
            hasContent={draft.content.items.length > 0}
          >
            <p className='is-size-7 has-text-grey mb-2'>
              地点、时间、光线、构图、道具……不分类，按顺序拼成主 Prompt。
              不写画风串（交给生成端模板）；尺寸、种子等写在下面的「生成参数」。
            </p>
            <PromptItemList
              label='场景内容'
              segment={draft.content}
              customTags={draft.customTags}
              onChange={setContent}
              emptyHint='还没有条目。在下面输入框里搜词库标签、选场景自创标签，或直接输入文本；也可以把 NovelAI 生成的图片拖到页面上导入。'
              addBox={
                <SceneTagInput
                  label='场景内容'
                  segment={draft.content}
                  customTags={draft.customTags}
                  onChange={setContent}
                  onCreateCustomTag={onCreateCustomTag}
                />
              }
            />
          </Section>

          <Section
            title='人物'
            anchor='sec-slots'
            hasContent={draft.slots.length > 0}
            summary={`${draft.slots.length} / ${MAX_SCENE_SLOTS}`}
          >
            {draft.slots.length === 0 && (
              <p className='is-size-7 has-text-grey mb-2'>
                还没有人物。从 TagLoom 人物导入一份快照（人物 + 造型组合 +
                状态），或添加一个纯手写的人物。
              </p>
            )}
            {draft.slots.map((slot, i) => (
              <SlotEditor
                key={slot.id}
                slot={slot}
                index={i}
                count={draft.slots.length}
                customTags={draft.customTags}
                onChange={(fn) => updateSlot(slot.id, fn)}
                onCreateCustomTag={onCreateCustomTag}
                onMove={(delta) => moveSlot(slot.id, delta)}
                onRemove={() =>
                  update((c) => ({
                    ...c,
                    slots: c.slots.filter((s) => s.id !== slot.id),
                  }))}
              />
            ))}
            <div className='buttons'>
              <button
                type='button'
                className='button is-primary is-light'
                disabled={full}
                onClick={() => setPicking(true)}
              >
                ＋ 从人物导入
              </button>
              <button
                type='button'
                className='button'
                disabled={full}
                onClick={() =>
                  update((c) => ({ ...c, slots: [...c.slots, emptySlot()] }))}
              >
                ＋ 手写人物
              </button>
              {full && (
                <span className='is-size-7 has-text-grey'>
                  最多 {MAX_SCENE_SLOTS} 个人物
                </span>
              )}
            </div>
          </Section>

          <Section
            title='负面 Prompt'
            anchor='sec-negative'
            hasContent={draft.negativePrompt.trim().length > 0}
            defaultOpen={false}
          >
            <textarea
              className='textarea'
              rows={3}
              aria-label='场景负面 Prompt'
              placeholder='整张图希望避免出现的内容；人物自己的负面在各人物的快照里'
              maxLength={200_000}
              value={draft.negativePrompt}
              onChange={(e) => {
                const v = e.target.value
                update((c) => ({ ...c, negativePrompt: v }))
              }}
            />
          </Section>

          <Section
            title='生成参数（可选）'
            anchor='sec-params'
            hasContent={cleanSceneParams(draft.params) !== undefined}
            summary={sceneParamsSummary(cleanSceneParams(draft.params))}
            defaultOpen={false}
          >
            <SceneParamsEditor
              value={draft.params}
              onChange={(fn) =>
                update((c) => {
                  const params = fn(c.params ?? {})
                  const { params: _drop, ...rest } = c
                  return Object.keys(params).length ? { ...rest, params } : rest
                })}
              reportInvalid={reportInvalid}
            />
          </Section>

          <Section
            title='场景标签库'
            anchor='sec-custom-tags'
            hasContent={draft.customTags.length > 0}
            summary={`${draft.customTags.length} 个`}
            defaultOpen={false}
          >
            <CustomTagLibrary
              content={draft}
              usage={sceneCustomTagUsage(draft)}
              onChange={update}
              showFields={false}
              emptyHint='还没有场景自创标签。在输入框里写好文本后点「存为自创标签」创建。'
            />
          </Section>
        </div>

        <div className='column is-4 is-hidden-mobile'>
          <Preview draft={draft} />
        </div>
      </div>

      <div className='tagloom-fab-spacer is-hidden-tablet' aria-hidden='true' />
      <button
        type='button'
        className='button is-link tagloom-preview-fab is-hidden-tablet'
        aria-haspopup='dialog'
        onClick={() => setPreviewOpen(true)}
      >
        预览 Prompt
      </button>
      <BottomSheet
        title='预览 Prompt'
        open={previewOpen}
        onClose={closePreview}
      >
        <Preview draft={draft} />
      </BottomSheet>

      <CharacterPicker
        open={picking}
        initial={null}
        onPick={(snapshot) => {
          update((c) => ({
            ...c,
            slots: [...c.slots, replaceSnapshot(emptySlot(), snapshot)],
          }))
          setPicking(false)
        }}
        onCancel={() => setPicking(false)}
      />
    </>
  )
}

// 目录：和页面上的分区一一对应，顺序相同
function navItems(draft: SceneContent): SectionNavItem[] {
  return [
    {
      anchor: 'sec-note',
      label: '备注',
      hasContent: draft.note.trim().length > 0,
    },
    {
      anchor: 'sec-content',
      label: '场景内容',
      hasContent: draft.content.items.length > 0,
    },
    {
      anchor: 'sec-slots',
      label: `人物（${draft.slots.length} / ${MAX_SCENE_SLOTS}）`,
      hasContent: draft.slots.length > 0,
    },
    {
      anchor: 'sec-negative',
      label: '负面 Prompt',
      hasContent: draft.negativePrompt.trim().length > 0,
    },
    {
      anchor: 'sec-params',
      label: '生成参数',
      hasContent: cleanSceneParams(draft.params) !== undefined,
    },
    {
      anchor: 'sec-custom-tags',
      label: '场景标签库',
      hasContent: draft.customTags.length > 0,
    },
  ]
}

function Preview({ draft }: { draft: SceneContent }) {
  return (
    <div className='tagloom-preview'>
      <div className='box'>
        <p className='title is-6 mb-2'>预览 · {sceneDisplayTitle(draft)}</p>
        <PreviewBlock label='主 Prompt' text={scenePrompt(draft)} strong />
        <PreviewBlock label='负面 Prompt' text={sceneNegative(draft)} />
        {draft.slots.map((slot, i) => (
          <div key={slot.id}>
            <PreviewBlock
              label={`${slotDisplayLabel(slot, i)}${
                slot.position
                  ? `（x ${slot.position.x}，y ${slot.position.y}）`
                  : ''
              }`}
              text={slotPrompt(slot)}
            />
            {slotNegative(slot) && (
              <PreviewBlock
                label={`${slotDisplayLabel(slot, i)} · 负面`}
                text={slotNegative(slot)}
              />
            )}
          </div>
        ))}
        <ParamsPreview draft={draft} />
      </div>
    </div>
  )
}

function ParamsPreview({ draft }: { draft: SceneContent }) {
  const p = cleanSceneParams(draft.params)
  if (!p) return null
  return (
    <PreviewBlock
      label='生成参数'
      text={SCENE_PARAM_KEYS.filter((k) => p[k] !== undefined)
        .map((k) => `${k}: ${p[k]}`).join('\n')}
    />
  )
}

function ExportMenu(
  { path, dirty, onSend }: { path: string; dirty: boolean; onSend: () => void },
) {
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
            onClick={() => {
              onSend()
              setOpen(false)
            }}
          >
            发送到其他模块（当前编辑内容）
          </button>
          <hr className='dropdown-divider' />
          {dirty && (
            <div className='dropdown-item is-size-7 theme-warning-text'>
              导出的是已保存的版本，请先保存。
            </div>
          )}
          <a
            className='dropdown-item'
            href={exportSceneUrl(path, 'json')}
            download
            onClick={() => setOpen(false)}
          >
            下游成品 · JSON（prompt + characters[]）
          </a>
          <a
            className='dropdown-item'
            href={exportSceneUrl(path, 'text')}
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
