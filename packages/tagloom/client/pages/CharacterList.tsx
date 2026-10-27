// 人物列表：按文件夹一层一层浏览（当前文件夹在 URL 的 ?folder= 里），
// 新建人物 / 文件夹、导入人物存档（「更多」里选文件，或把文件拖到页面上）、移动 / 改名、删除；
// 全局搜索（?q=）会读一遍所有文件夹。
import { type ChangeEvent, type ReactNode, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useSearch } from 'wouter'
import { entryNameError, joinPath, nameOf, stemOf } from '@app/tagloom/share'
import {
  api,
  type ApiError,
  apiErrorOf,
  editHref,
  folderHref,
  keys,
  parseResponse,
} from '../api.ts'
import {
  ConfirmModal,
  ErrorNotice,
  formatTime,
  Loading,
  useTitle,
} from '../components/common.tsx'
import { MoreMenu, MoreMenuItem } from '../components/MoreMenu.tsx'
import { usePageFileDrop } from '../components/file-drop.ts'
import { CatalogBanner } from '../components/CatalogBanner.tsx'
import {
  Breadcrumb,
  NameModal,
  RowActions,
  SearchBox,
} from '../components/ListParts.tsx'

interface Summary {
  path: string
  version: number
  title: string
  comboCount: number
  updatedAt: number
}

// 正在移动 / 改名或删除的对象
type Target =
  | { kind: 'character'; path: string; version: number; title: string }
  | { kind: 'folder'; path: string }

export default function CharacterList() {
  const params = new URLSearchParams(useSearch())
  const folder = params.get('folder') ?? ''
  const q = params.get('q') ?? ''
  useTitle(folder ? `人物 · ${nameOf(folder)}` : '人物')
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const [error, setError] = useState<ApiError | null>(null)
  const [moving, setMoving] = useState<Target | null>(null)
  const [deleting, setDeleting] = useState<Target | null>(null)
  const [newFolder, setNewFolder] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const listing = useQuery({
    queryKey: keys.folder(folder),
    queryFn: () => parseResponse(api.characters.$get({ query: { folder } })),
    enabled: !q,
    // 每次进入文件夹都重新读盘：资源管理器里的改动下次打开就能看到
    staleTime: 0,
  })
  const search = useQuery({
    queryKey: keys.search(q),
    queryFn: () => parseResponse(api.characters.search.$get({ query: { q } })),
    enabled: !!q,
    staleTime: 0,
  })
  const onError = (e: unknown) => setError(apiErrorOf(e))
  const refreshLists = () => qc.invalidateQueries({ queryKey: keys.list })

  const create = useMutation({
    mutationFn: () => parseResponse(api.characters.$post({ json: { folder } })),
    onSuccess: (c) => navigate(editHref(c.path)),
    onError,
  })
  const importArchive = useMutation({
    mutationFn: async (file: File) => {
      let archive: unknown
      try {
        archive = JSON.parse(await file.text())
      } catch {
        throw new Error('文件不是有效的 JSON')
      }
      return parseResponse(
        api.characters.import.$post({ json: { archive, folder } }),
      )
    },
    onSuccess: (c) => {
      refreshLists()
      navigate(editHref(c.path))
    },
    onError,
  })
  const createFolder = useMutation({
    mutationFn: (path: string) =>
      parseResponse(api.folders.$post({ json: { path } })),
    onSuccess: () => {
      setNewFolder(false)
      return refreshLists()
    },
  })
  const move = useMutation({
    mutationFn: async ({ target, to }: { target: Target; to: string }) => {
      if (target.kind === 'character') {
        await parseResponse(
          api.characters.item.move.$post({
            query: { path: target.path },
            json: { expectedVersion: target.version, to },
          }),
        )
      } else {
        await parseResponse(
          api.folders.move.$post({ json: { path: target.path, to } }),
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
      target.kind === 'character'
        ? parseResponse(
          api.characters.item.$delete({
            query: {
              path: target.path,
              expectedVersion: String(target.version),
            },
          }),
        )
        : parseResponse(
          api.folders.$delete({ query: { path: target.path } }),
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

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) importArchive.mutate(file)
  }
  const dragging = usePageFileDrop(
    (file) => importArchive.mutate(file),
    !importArchive.isPending,
  )

  const characterRow = (c: Summary, showFolder: boolean) => (
    <tr key={c.path}>
      <td>
        <Link href={editHref(c.path)}>{c.title}</Link>
        {(showFolder || stemOf(c.path) !== c.title) && (
          <p className='is-size-7 has-text-grey tagloom-file-name'>
            {showFolder ? c.path : nameOf(c.path)}
          </p>
        )}
      </td>
      <td>{c.comboCount}</td>
      <td className='text-nowrap'>{formatTime(c.updatedAt)}</td>
      <td className='has-text-right'>
        <RowActions
          onMove={() =>
            setMoving({
              kind: 'character',
              path: c.path,
              version: c.version,
              title: c.title,
            })}
          onDelete={() =>
            setDeleting({
              kind: 'character',
              path: c.path,
              version: c.version,
              title: c.title,
            })}
        />
      </td>
    </tr>
  )

  const table = (rows: ReactNode) => (
    <div className='table-container'>
      <table className='table is-fullwidth is-hoverable'>
        <thead>
          <tr>
            <th>名称</th>
            <th>造型组合</th>
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
      ? <ErrorNotice error={apiErrorOf(search.error)} />
      : (
        <>
          <p className='has-text-grey mb-2' aria-live='polite'>
            在所有文件夹中找到 {search.data.length} 个人物
          </p>
          {search.data.length > 0 &&
            table(search.data.map((c) => characterRow(c, true)))}
        </>
      )
  } else if (listing.isPending) {
    body = <Loading />
  } else if (listing.error) {
    body = <ErrorNotice error={apiErrorOf(listing.error)} />
  } else {
    const { folders, characters, otherFiles } = listing.data
    body = (
      <>
        {folders.length === 0 && characters.length === 0
          ? (
            <p className='has-text-grey has-text-centered py-6'>
              {folder
                ? '这个文件夹是空的。可以新建人物或子文件夹，或把人物移到这里。'
                : '还没有人物。新建一个，或把之前导出的人物存档拖到页面上（导入总是建立新人物，不覆盖已有人物）。'}
            </p>
          )
          : table(
            <>
              {folders.map((f) => (
                <tr key={f.path}>
                  <td colSpan={3}>
                    <Link href={folderHref(f.path)}>
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
              {characters.map((c) => characterRow(c, false))}
            </>,
          )}
        {otherFiles > 0 && (
          <p className='help'>
            这个文件夹里还有 {otherFiles} 个不是人物的 JSON 文件，可以在
            <Link href={`/files?${new URLSearchParams({ folder })}`}>
              人物文件浏览
            </Link>
            里查看或导入。
          </p>
        )}
      </>
    )
  }

  return (
    <>
      <div className='tagloom-toolbar mb-4'>
        <h1 className='title is-4 mb-0'>人物</h1>
        <div className='buttons mb-0'>
          <MoreMenu over={dragging}>
            {(close) => (
              <>
                <MoreMenuItem
                  loading={importArchive.isPending}
                  onSelect={() => {
                    close()
                    fileInput.current?.click()
                  }}
                >
                  导入人物存档…（也可以拖到页面上）
                </MoreMenuItem>
                <MoreMenuItem
                  href={`/files?${new URLSearchParams({ folder })}`}
                  onSelect={close}
                >
                  人物文件浏览
                </MoreMenuItem>
              </>
            )}
          </MoreMenu>
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
            新建人物
          </button>
          <input
            ref={fileInput}
            type='file'
            accept='.json,application/json'
            className='is-hidden'
            aria-label='选择人物存档文件'
            onChange={onFile}
          />
        </div>
      </div>
      <CatalogBanner />
      <SearchBox
        key={q}
        initial={q}
        label='在所有文件夹中按名称或路径搜索人物'
        onSearch={(text) =>
          navigate(
            text ? `/?${new URLSearchParams({ q: text })}` : folderHref(folder),
          )}
      />
      {q
        ? (
          <p className='mb-3'>
            <Link href={folderHref(folder)}>← 清除搜索，回到文件夹</Link>
          </p>
        )
        : (
          <Breadcrumb
            folder={folder}
            rootLabel='全部人物'
            hrefOf={folderHref}
          />
        )}
      <ErrorNotice error={error} onClose={() => setError(null)} />
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
          : '移动 / 改名人物'}
        label='新位置（相对于人物根目录，用 / 分隔文件夹）'
        help={moving?.kind === 'folder'
          ? '例如「漫画B/第2卷」。上级文件夹必须已经存在；目标已存在时不会覆盖。'
          : '例如「漫画B/艾莉丝.json」。上级文件夹必须已经存在；目标已存在时不会覆盖。改名不影响人物内容里的人物名。'}
        initial={moving?.path ?? ''}
        busy={move.isPending}
        error={move.error ? apiErrorOf(move.error) : null}
        check={(v) => {
          const name = nameOf(v.trim())
          if (moving?.kind === 'character') {
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
          ? '只能删除空文件夹；里面还有人物或其他文件时需要先移走或删除。'
          : '人物文件会被删除，无法恢复。需要备份请先在编辑页导出人物存档。'}
      </ConfirmModal>
    </>
  )
}
