// 文件浏览状态放在 URL 中，支持刷新、分享和浏览器前进/后退。
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useSearch } from 'wouter'
import {
  api,
  apiErrorOf,
  editHref,
  folderHref,
  keys,
  parseResponse,
} from '../api.ts'
import {
  ErrorNotice,
  formatTime,
  Loading,
  useTitle,
} from '../components/common.tsx'

function filesHref(folder: string, path = '') {
  const query = new URLSearchParams()
  if (folder) query.set('folder', folder)
  if (path) query.set('path', path)
  return `/files${query.size ? `?${query}` : ''}`
}

function sizeText(bytes: number | null) {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export default function CharacterFiles() {
  useTitle('人物文件浏览')
  const params = new URLSearchParams(useSearch())
  const folder = params.get('folder') ?? ''
  const path = params.get('path') ?? ''
  const [filter, setFilter] = useState('')
  const qc = useQueryClient()
  const files = useQuery({
    queryKey: keys.files(folder),
    queryFn: () => parseResponse(api.files.$get({ query: { folder } })),
    staleTime: 0,
  })
  const parts = folder ? folder.split('/') : []
  const entries =
    files.data?.entries.filter((e) =>
      e.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
    ) ?? []

  function refresh() {
    qc.invalidateQueries({ queryKey: keys.files(folder) })
    if (path) qc.invalidateQueries({ queryKey: keys.file(path) })
  }

  return (
    <>
      <div className='is-flex is-flex-wrap-wrap is-justify-content-space-between is-align-items-center mb-4'>
        <h1 className='title is-4 mb-3'>人物文件浏览</h1>
        <div className='buttons'>
          <Link href={folderHref(folder)} className='button'>返回人物列表</Link>
          <button
            type='button'
            className={`button${files.isFetching ? ' is-loading' : ''}`}
            disabled={files.isFetching}
            onClick={refresh}
          >
            刷新硬盘
          </button>
        </div>
      </div>
      <p className='has-text-grey mb-4'>
        直接读取服务器上的 data/tagloom/characters/，显示子文件夹和所有 JSON
        文件（包括不是人物的外部文件）。浏览只读；导入会在源文件所在的文件夹建立新人物，不修改源文件。
      </p>
      <nav
        className='breadcrumb tagloom-file-breadcrumb'
        aria-label='人物文件路径'
      >
        <ul>
          <li className={folder ? '' : 'is-active'}>
            <Link
              href={filesHref('')}
              aria-current={folder ? undefined : 'page'}
            >
              人物文件根目录
            </Link>
          </li>
          {parts.map((part, i) => (
            <li key={i} className={i === parts.length - 1 ? 'is-active' : ''}>
              <Link
                href={filesHref(parts.slice(0, i + 1).join('/'))}
                aria-current={i === parts.length - 1 ? 'page' : undefined}
              >
                {part}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className='columns'>
        <section
          className={`column${path ? ' is-7-desktop' : ''}`}
          aria-label='文件列表'
        >
          <div className='field'>
            <label className='label' htmlFor='tagloom-file-filter'>
              筛选当前目录
            </label>
            <div className='control'>
              <input
                id='tagloom-file-filter'
                className='input'
                type='search'
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder='按文件名筛选'
              />
            </div>
          </div>
          {folder && (
            <p className='mb-3'>
              <Link href={filesHref(parts.slice(0, -1).join('/'))}>
                返回上级文件夹
              </Link>
            </p>
          )}
          {files.isPending
            ? <Loading />
            : files.error
            ? <ErrorNotice error={apiErrorOf(files.error)} />
            : (
              <>
                <p className='has-text-grey mb-2' aria-live='polite'>
                  {entries.length} 个条目
                </p>
                {entries.length === 0
                  ? (
                    <p className='has-text-grey py-5'>
                      {filter
                        ? '没有匹配的文件或文件夹。'
                        : '此文件夹没有子文件夹或 JSON 文件。'}
                    </p>
                  )
                  : (
                    <div className='table-container'>
                      <table className='table is-fullwidth is-hoverable'>
                        <thead>
                          <tr>
                            <th>名称</th>
                            <th>类型</th>
                            <th>大小</th>
                            <th>磁盘修改时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entries.map((entry) => (
                            <tr
                              key={entry.path}
                              className={entry.path === path
                                ? 'is-selected'
                                : ''}
                            >
                              <td className='tagloom-file-name'>
                                <Link
                                  href={entry.kind === 'folder'
                                    ? filesHref(entry.path)
                                    : filesHref(folder, entry.path)}
                                >
                                  {entry.name}
                                </Link>
                              </td>
                              <td className='text-nowrap'>
                                {entry.kind === 'folder' ? '文件夹' : 'JSON'}
                              </td>
                              <td className='text-nowrap'>
                                {sizeText(entry.bytes)}
                              </td>
                              <td className='text-nowrap'>
                                {entry.modifiedAt
                                  ? formatTime(entry.modifiedAt)
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </>
            )}
        </section>
        {path && (
          <section className='column is-5-desktop' aria-label='文件预览'>
            <div className='box'>
              <div className='is-flex is-justify-content-space-between mb-3'>
                <h2 className='title is-5 mb-0'>文件预览</h2>
                <Link href={filesHref(folder)}>关闭预览</Link>
              </div>
              <FilePreview key={path} path={path} />
            </div>
          </section>
        )}
      </div>
    </>
  )
}

function FilePreview({ path }: { path: string }) {
  const [, navigate] = useLocation()
  const qc = useQueryClient()
  const preview = useQuery({
    queryKey: keys.file(path),
    queryFn: () => parseResponse(api.files.preview.$get({ query: { path } })),
    staleTime: 0,
  })
  const importFile = useMutation({
    mutationFn: () => parseResponse(api.files.import.$post({ json: { path } })),
    onSuccess: (character) => {
      qc.invalidateQueries({ queryKey: keys.list })
      qc.invalidateQueries({ queryKey: ['tagloom', 'files'] })
      navigate(editHref(character.path))
    },
  })
  if (preview.isPending) return <Loading />
  if (preview.error) return <ErrorNotice error={apiErrorOf(preview.error)} />
  const file = preview.data
  return (
    <>
      <p className='tagloom-file-name mb-3'>{path}</p>
      {file.summary
        ? (
          <>
            <p className='mb-2'>
              <strong>{file.summary.title}</strong>
            </p>
            <p className='has-text-grey mb-3'>
              {file.kind === 'project' ? '人物存档 v2' : '人物数据'} ·{' '}
              {file.summary.comboCount} 个造型组合
            </p>
            <p className='tagloom-file-profile mb-4'>
              {file.summary.profile || '（没有人物档案）'}
            </p>
            <h3 className='has-text-weight-semibold mb-2'>画风串</h3>
            <p className='tagloom-file-profile mb-4'>
              {file.summary.stylePrompt || '（未记录画风串）'}
            </p>
            <button
              type='button'
              className={`button is-primary mb-3${
                importFile.isPending ? ' is-loading' : ''
              }`}
              disabled={importFile.isPending || preview.isFetching}
              onClick={() => importFile.mutate()}
            >
              导入为新人物并编辑
            </button>
            <p className='help mb-3'>
              导入时重新读取硬盘文件，在同一文件夹里建立新人物；之后的编辑不会修改此源文件。
            </p>
          </>
        )
        : (
          <p className='notification is-warning is-light'>
            {file.kind === 'invalid'
              ? '文件不是有效 JSON，仅展示原文。'
              : '此 JSON 不是可导入的人物数据或人物存档 v2，仅供预览。'}
          </p>
        )}
      <ErrorNotice
        error={importFile.error ? apiErrorOf(importFile.error) : null}
      />
      <details open={!file.summary}>
        <summary>JSON 原文</summary>
        <pre className='tagloom-file-source mt-3'>{file.text}</pre>
      </details>
    </>
  )
}
