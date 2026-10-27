// 场景列表：按文件夹一层一层浏览（?folder=），新建场景 / 文件夹、从 NovelAI 图片新建（「更多」或拖到页面上）、复制、移动 / 改名、删除；
// 全文搜索（?q=）会读一遍所有文件夹，匹配标题、条目、自创标签、人物名称和快照文本。
import { type ReactNode, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useSearch } from 'wouter'
import { parseNovelaiPng } from '@app/shared/novelai'
import { entryNameError, joinPath, nameOf, stemOf } from '@app/tagloom/share'
import {
  api,
  type ApiError,
  apiErrorOf,
  keys,
  parseResponse,
  sceneEditHref,
  sceneFolderHref,
} from '../api.ts'
import {
  ConfirmModal,
  ErrorNotice,
  formatTime,
  Loading,
  useTitle,
} from '../components/common.tsx'
import {
  Breadcrumb,
  NameModal,
  RowActions,
  SearchBox,
} from '../components/ListParts.tsx'
import { HandoffNewScene } from '../components/HandoffBanner.tsx'
import { MoreMenu, MoreMenuItem } from '../components/MoreMenu.tsx'
import { usePageFileDrop } from '../components/file-drop.ts'
import { stashSceneImage } from '../components/SceneImport.tsx'

interface Summary {
  path: string
  version: number
  title: string
  slotCount: number
  updatedAt: number
}

type Target =
  | { kind: 'scene'; path: string; version: number; title: string }
  | { kind: 'folder'; path: string }

export default function SceneList() {
  const params = new URLSearchParams(useSearch())
  const folder = params.get('folder') ?? ''
  const q = params.get('q') ?? ''
  useTitle(folder ? `场景 · ${nameOf(folder)}` : '场景')
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const [error, setError] = useState<ApiError | null>(null)
  const [moving, setMoving] = useState<Target | null>(null)
  const [deleting, setDeleting] = useState<Target | null>(null)
  const [newFolder, setNewFolder] = useState(false)

  const listing = useQuery({
    queryKey: keys.sceneFolder(folder),
    queryFn: () => parseResponse(api.scenes.$get({ query: { folder } })),
    enabled: !q,
    staleTime: 0,
  })
  const search = useQuery({
    queryKey: keys.sceneSearch(q),
    queryFn: () => parseResponse(api.scenes.search.$get({ query: { q } })),
    enabled: !!q,
    staleTime: 0,
  })
  const onError = (e: unknown) => setError(apiErrorOf(e))
  const refreshLists = () => qc.invalidateQueries({ queryKey: keys.sceneList })

  const create = useMutation({
    mutationFn: () => parseResponse(api.scenes.$post({ json: { folder } })),
    onSuccess: (s) => navigate(sceneEditHref(s.path)),
    onError,
  })
  // 从 NovelAI 图片新建：先确认图片里有 NovelAI 信息，再新建场景，编辑页接着弹出导入确认
  const imageInput = useRef<HTMLInputElement>(null)
  const fromImage = useMutation({
    mutationFn: async (file: File) => {
      const meta = parseNovelaiPng(new Uint8Array(await file.arrayBuffer()))
      if (!meta) throw new Error(`「${file.name}」里没有 NovelAI 信息。`)
      const s = await parseResponse(api.scenes.$post({ json: { folder } }))
      stashSceneImage(file)
      return s
    },
    onSuccess: (s) => navigate(sceneEditHref(s.path)),
    onError,
  })
  const dragging = usePageFileDrop(
    (file) => fromImage.mutate(file),
    !fromImage.isPending,
  )
  const copy = useMutation({
    mutationFn: (path: string) =>
      parseResponse(api.scenes.item.copy.$post({ query: { path }, json: {} })),
    onSuccess: () => refreshLists(),
    onError,
  })
  const createFolder = useMutation({
    mutationFn: (path: string) =>
      parseResponse(api.scenes.folders.$post({ json: { path } })),
    onSuccess: () => {
      setNewFolder(false)
      return refreshLists()
    },
  })
  const move = useMutation({
    mutationFn: async ({ target, to }: { target: Target; to: string }) => {
      if (target.kind === 'scene') {
        await parseResponse(
          api.scenes.item.move.$post({
            query: { path: target.path },
            json: { expectedVersion: target.version, to },
          }),
        )
      } else {
        await parseResponse(
          api.scenes.folders.move.$post({ json: { path: target.path, to } }),
        )
      }
    },
    onSuccess: () => {
      setMoving(null)
      return refreshLists()
    },
  })
  const remove = useMutation({
    mutationFn: (target: Target) =>
      target.kind === 'scene'
        ? parseResponse(
          api.scenes.item.$delete({
            query: {
              path: target.path,
              expectedVersion: String(target.version),
            },
          }),
        )
        : parseResponse(
          api.scenes.folders.$delete({ query: { path: target.path } }),
        ),
    onSuccess: () => {
      setDeleting(null)
      return refreshLists()
    },
    onError: (e) => {
      setDeleting(null)
      onError(e)
    },
  })

  const sceneRow = (s: Summary, showFolder: boolean) => (
    <tr key={s.path}>
      <td>
        <Link href={sceneEditHref(s.path)}>{s.title}</Link>
        {(showFolder || stemOf(s.path) !== s.title) && (
          <p className='is-size-7 has-text-grey tagloom-file-name'>
            {showFolder ? s.path : nameOf(s.path)}
          </p>
        )}
      </td>
      <td>{s.slotCount}</td>
      <td className='text-nowrap'>{formatTime(s.updatedAt)}</td>
      <td className='has-text-right'>
        <div className='is-flex is-justify-content-flex-end'>
          <button
            type='button'
            className='button is-small mr-2'
            disabled={copy.isPending}
            onClick={() => copy.mutate(s.path)}
          >
            复制
          </button>
          <RowActions
            onMove={() =>
              setMoving({
                kind: 'scene',
                path: s.path,
                version: s.version,
                title: s.title,
              })}
            onDelete={() =>
              setDeleting({
                kind: 'scene',
                path: s.path,
                version: s.version,
                title: s.title,
              })}
          />
        </div>
      </td>
    </tr>
  )

  const table = (rows: ReactNode) => (
    <div className='table-container'>
      <table className='table is-fullwidth is-hoverable'>
        <thead>
          <tr>
            <th>名称</th>
            <th>人物</th>
            <th>最后修改</th>
            <th>
              <span className='is-sr-only'>操作</span>
            </th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  )

  let body: ReactNode
  if (q) {
    body = search.isPending
      ? <Loading />
      : search.error
      ? <ErrorNotice noun='场景' error={apiErrorOf(search.error)} />
      : (
        <>
          <p className='has-text-grey mb-2' aria-live='polite'>
            在所有文件夹中找到 {search.data.length} 个场景
          </p>
          {search.data.length > 0 &&
            table(search.data.map((s) => sceneRow(s, true)))}
        </>
      )
  } else if (listing.isPending) {
    body = <Loading />
  } else if (listing.error) {
    body = <ErrorNotice noun='场景' error={apiErrorOf(listing.error)} />
  } else {
    const { folders, scenes, otherFiles } = listing.data
    body = (
      <>
        {folders.length === 0 && scenes.length === 0
          ? (
            <p className='has-text-grey has-text-centered py-6'>
              {folder
                ? '这个文件夹是空的。可以新建场景或子文件夹，或把场景移到这里。'
                : '还没有场景。场景把场景标签和若干人物（从 TagLoom 人物导入的快照或手写）组合成一份多角色 Prompt。'}
            </p>
          )
          : table(
            <>
              {folders.map((f) => (
                <tr key={f.path}>
                  <td colSpan={3}>
                    <Link href={sceneFolderHref(f.path)}>
                      <span aria-hidden='true'>📁</span> {f.name}
                    </Link>
                  </td>
                  <td className='has-text-right'>
                    <RowActions
                      onMove={() => setMoving({ kind: 'folder', path: f.path })}
                      onDelete={() =>
                        setDeleting({ kind: 'folder', path: f.path })}
                    />
                  </td>
                </tr>
              ))}
              {scenes.map((s) => sceneRow(s, false))}
            </>,
          )}
        {otherFiles > 0 && (
          <p className='help'>
            这个文件夹里还有 {otherFiles} 个不是场景的 JSON 文件。
          </p>
        )}
      </>
    )
  }

  return (
    <>
      <div className='tagloom-toolbar mb-4'>
        <h1 className='title is-4 mb-0'>场景</h1>
        <div className='buttons mb-0'>
          <MoreMenu over={dragging}>
            {(close) => (
              <MoreMenuItem
                loading={fromImage.isPending}
                onSelect={() => {
                  close()
                  imageInput.current?.click()
                }}
              >
                从 NovelAI 图片新建场景…（也可以拖到页面上）
              </MoreMenuItem>
            )}
          </MoreMenu>
          <input
            ref={imageInput}
            type='file'
            accept='image/png'
            className='is-hidden'
            aria-label='选择 NovelAI 生成的图片'
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) fromImage.mutate(file)
            }}
          />
          <button
            type='button'
            className='button'
            onClick={() => {
              createFolder.reset()
              setNewFolder(true)
            }}
          >
            新建文件夹
          </button>
          <button
            type='button'
            className={`button is-primary${
              create.isPending ? ' is-loading' : ''
            }`}
            onClick={() => create.mutate()}
          >
            新建场景
          </button>
        </div>
      </div>
      <SearchBox
        key={q}
        initial={q}
        label='在所有文件夹中搜索场景（标题、标签、人物、快照文本）'
        onSearch={(text) =>
          navigate(
            text
              ? `/scenes?${new URLSearchParams({ q: text })}`
              : sceneFolderHref(folder),
          )}
      />
      {q
        ? (
          <p className='mb-3'>
            <Link href={sceneFolderHref(folder)}>← 清除搜索，回到文件夹</Link>
          </p>
        )
        : (
          <Breadcrumb
            folder={folder}
            rootLabel='全部场景'
            hrefOf={sceneFolderHref}
          />
        )}
      <ErrorNotice noun='场景' error={error} onClose={() => setError(null)} />
      <HandoffNewScene
        create={async (content) => {
          const s = await parseResponse(
            api.scenes.$post({ json: { folder, content } }),
          )
          refreshLists()
          navigate(sceneEditHref(s.path))
        }}
      />
      {body}

      <NameModal
        open={newFolder}
        title='新建文件夹'
        label={`名称（建在「${folder || '根目录'}」里）`}
        initial=''
        busy={createFolder.isPending}
        error={createFolder.error ? apiErrorOf(createFolder.error) : null}
        check={(v) => entryNameError(v)}
        onSubmit={(name) => createFolder.mutate(joinPath(folder, name))}
        onCancel={() => setNewFolder(false)}
      />
      <NameModal
        open={moving !== null}
        title={moving?.kind === 'folder'
          ? '移动 / 改名文件夹'
          : '移动 / 改名场景'}
        label='新位置（相对于场景根目录，用 / 分隔文件夹）'
        help={moving?.kind === 'folder'
          ? '例如「第2章/夜晚」。上级文件夹必须已经存在；目标已存在时不会覆盖。'
          : '例如「第2章/街道.json」。上级文件夹必须已经存在；目标已存在时不会覆盖。改名不影响场景内容里的标题。'}
        initial={moving?.path ?? ''}
        busy={move.isPending}
        error={move.error ? apiErrorOf(move.error) : null}
        check={(v) => {
          const name = nameOf(v.trim())
          if (moving?.kind === 'scene') {
            if (!name.endsWith('.json')) return '文件名必须以 .json 结尾'
            return entryNameError(name.slice(0, -'.json'.length))
          }
          return entryNameError(name)
        }}
        onSubmit={(to) => moving && move.mutate({ target: moving, to })}
        onCancel={() => {
          move.reset()
          setMoving(null)
        }}
      />
      <ConfirmModal
        open={deleting !== null}
        title={deleting?.kind === 'folder'
          ? `删除文件夹「${nameOf(deleting.path)}」？`
          : `删除「${deleting?.title ?? ''}」？`}
        confirmLabel='删除'
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      >
        {deleting?.kind === 'folder'
          ? '只能删除空文件夹；里面还有场景或其他文件时需要先移走或删除。'
          : '场景文件会被删除，无法恢复。用到的人物文件不受影响。'}
      </ConfirmModal>
    </>
  )
}
