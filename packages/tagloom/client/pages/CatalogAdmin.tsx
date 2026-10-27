// 词库页：当前词库的状态和导入记录；从数据源目录（data/data_source）选一个目录，检测格式后导入。
// tags-tree 会从头重新生成词库（已导入的 CSV 会清空，要先确认）；CSV 作为附加信息导入，
// 可以勾选文件（画师默认不勾）、改来源名和数据版本。导入成功后服务端自动重新加载词库。
import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiErrorOf, parseResponse } from '../api.ts'
import { ErrorNotice, Loading, useTitle } from '../components/common.tsx'

const adminKeys = {
  status: ['tagloom', 'catalog-admin', 'status'] as const,
  dirs: (path: string) => ['tagloom', 'catalog-admin', 'dirs', path] as const,
}

type Detect = Awaited<ReturnType<typeof detectDir>>
type CsvFile = Detect['csv'][number]
type ImportResult = Awaited<ReturnType<typeof runImport>>
type ImportBody = Parameters<typeof api.catalog.admin.import.$post>[0]['json']

const detectDir = (path: string) =>
  parseResponse(api.catalog.admin.detect.$post({ json: { path } }))
const runImport = (json: ImportBody) =>
  parseResponse(api.catalog.admin.import.$post({ json }))

const STATUS_LABEL: Record<CsvFile['status'], [string, string]> = {
  full: ['is-success is-light', '完全符合'],
  extra: ['is-info is-light', '部分符合'],
  'tag-only': ['is-info is-light', '只有标签名'],
  'no-tag': ['is-danger is-light', '没有 tag 列'],
  encoding: ['is-danger is-light', '编码不支持'],
  invalid: ['is-danger is-light', '格式错误'],
  'too-large': ['is-danger is-light', '文件太大'],
}
const IMPORTABLE = new Set<CsvFile['status']>(['full', 'extra', 'tag-only'])

const short = (rev: string) => (rev ? rev.slice(0, 7) : '无版本')
const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
const time = (iso: string) => (iso ? new Date(iso).toLocaleString() : '-')

export default function CatalogAdmin() {
  useTitle('词库导入')
  return (
    <div>
      <CurrentCatalog />
      <SourcesInfo />
      <ImportPanel />
    </div>
  )
}

// 已支持的数据来源：放进 data/data_source/ 的目录名用仓库名即可（检测按内容判断，不看目录名）
const SOURCES = [
  {
    name: 'danbooru-tags-tree',
    url: 'https://github.com/Jannchie/danbooru-tags-tree',
    kind: 'tags-tree',
    need: '必需',
    content:
      '标签分类树、三语名称（英 / 日 / 中）、使用次数。导入时从头生成词库。',
  },
  {
    name: 'danbooru-tags-data-zh（ame-la）',
    url: 'https://huggingface.co/datasets/ame-la/danbooru-tags-data-zh',
    kind: '标签 CSV',
    need: '可选',
    content:
      '中文名、别名、说明、类型、使用次数（tags/ 下按类型分的 CSV）。在 tags-tree 之后导入，补充到已有词库。',
  },
]

function SourcesInfo() {
  return (
    <section className='box'>
      <h2 className='title is-5'>数据来源</h2>
      <p className='mb-2'>
        词库由下面的公开数据生成。先把仓库下载到 <code>data/data_source/</code>
        {' '}
        下，再在「导入」里选择对应目录：先导入 tags-tree，再导入 CSV。
      </p>
      <div className='table-container'>
        <table className='table is-fullwidth is-narrow is-size-7'>
          <thead>
            <tr>
              <th>来源</th>
              <th>格式</th>
              <th>是否必需</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.url}>
                <td>
                  <a href={s.url} target='_blank' rel='noreferrer'>
                    {s.name}
                  </a>
                </td>
                <td>{s.kind}</td>
                <td>{s.need}</td>
                <td>{s.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className='is-size-7 mb-1'>下载（在项目根目录运行）：</p>
      <pre className='is-size-7 mb-2'>
        {SOURCES.map((s) =>
          `git clone ${s.url} data/data_source/${s.url.split('/').pop()}`
        ).join('\n')}
      </pre>
      <ul className='is-size-7 has-text-grey'>
        <li>
          其他带 <code>tag</code>{' '}
          列的 CSV（表头可含
          category、aliases、zh、count、notes）也能作为附加信息导入。
        </li>
        <li>
          tags-tree 只能从头生成：重新导入会清空已导入的 CSV，需要再导入一次。
        </li>
        <li>数据的使用许可以各自仓库的说明为准。</li>
      </ul>
    </section>
  )
}

function CurrentCatalog() {
  const status = useQuery({
    queryKey: adminKeys.status,
    queryFn: () => parseResponse(api.catalog.admin.status.$get()),
  })
  const [open, setOpen] = useState<number | null>(null)
  if (status.error) return <ErrorNotice error={apiErrorOf(status.error)} />
  if (!status.data) return <Loading />
  const { catalog, imports, file } = status.data
  return (
    <section className='box'>
      <h2 className='title is-5'>当前词库</h2>
      {catalog.available
        ? (
          <p>
            <span className='tag is-success is-light mr-2'>✓ 可用</span>
            {file} · 标签 {catalog.tagCount.toLocaleString()} · 版本{' '}
            <code>{catalog.version}</code>
          </p>
        )
        : (
          <p>
            <span className='tag is-warning is-light mr-2'>⚠ 不可用</span>
            {catalog.reason || '词库还没有生成，先导入 tags-tree。'}
          </p>
        )}
      {imports && imports.length > 0 && (
        <div className='table-container mt-3'>
          <table className='table is-fullwidth is-narrow is-size-7'>
            <thead>
              <tr>
                <th>次序</th>
                <th>来源</th>
                <th>类型</th>
                <th>版本</th>
                <th>许可</th>
                <th>数据版本</th>
                <th>导入时间</th>
                <th>文件</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((g) => (
                <Fragment key={g.seq}>
                  <tr>
                    <td>{g.seq}</td>
                    <td title={g.repository || undefined}>{g.name}</td>
                    <td>{g.kind === 'tags-tree' ? 'tags-tree' : 'CSV'}</td>
                    <td>
                      <code>{short(g.revision)}</code>
                      {g.dirty && (
                        <span className='has-text-warning-dark ml-1'>
                          （有未提交的修改）
                        </span>
                      )}
                    </td>
                    <td>{g.license || '-'}</td>
                    <td>{g.dataVersion || '-'}</td>
                    <td>{time(g.importedAt)}</td>
                    <td>
                      <button
                        type='button'
                        className='button is-text is-small p-0'
                        aria-expanded={open === g.seq}
                        onClick={() => setOpen(open === g.seq ? null : g.seq)}
                      >
                        {g.files.length} 个 {open === g.seq ? '▲' : '▼'}
                      </button>
                    </td>
                  </tr>
                  {open === g.seq && (
                    <tr>
                      <td colSpan={8}>
                        <ul>
                          {g.files.map((f) => (
                            <li key={f.path}>
                              <code>{f.path}</code> ·{' '}
                              {f.rows === null ? '' : `${f.rows} 行 · `}
                              {size(f.bytes)} · sha256{' '}
                              <code title={f.sha256}>
                                {f.sha256.slice(0, 12)}
                              </code>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ImportPanel() {
  const [path, setPath] = useState('')
  const dirs = useQuery({
    queryKey: adminKeys.dirs(path),
    queryFn: () =>
      parseResponse(api.catalog.admin.dirs.$get({ query: { path } })),
  })
  const detect = useMutation({ mutationFn: detectDir })
  const go = (p: string) => {
    setPath(p)
    detect.reset()
  }
  const parts = path ? path.split('/') : []

  return (
    <section className='box'>
      <h2 className='title is-5'>导入</h2>
      <p className='is-size-7 has-text-grey mb-3'>
        把来源项目（tags-tree 仓库，或带 tag 列的 CSV 所在的文件夹）放进{' '}
        <code>data/data_source/</code>，在下面选到它所在的目录后检测。
      </p>
      <nav className='breadcrumb mb-2' aria-label='当前目录'>
        <ul>
          <li className={path ? '' : 'is-active'}>
            <a
              href='#'
              onClick={(e) => {
                e.preventDefault()
                go('')
              }}
            >
              data_source
            </a>
          </li>
          {parts.map((p, i) => (
            <li key={i} className={i === parts.length - 1 ? 'is-active' : ''}>
              <a
                href='#'
                onClick={(e) => {
                  e.preventDefault()
                  go(parts.slice(0, i + 1).join('/'))
                }}
              >
                {p}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {dirs.error
        ? <ErrorNotice error={apiErrorOf(dirs.error)} />
        : !dirs.data
        ? <Loading />
        : (
          <div className='buttons are-small mb-2'>
            {dirs.data.dirs.length === 0 && (
              <span className='is-size-7 has-text-grey'>没有子目录</span>
            )}
            {dirs.data.dirs.map((d) => (
              <button
                type='button'
                key={d.path}
                className='button'
                onClick={() => go(d.path)}
              >
                📁 {d.name}
              </button>
            ))}
          </div>
        )}
      <button
        type='button'
        className={`button is-link${detect.isPending ? ' is-loading' : ''}`}
        disabled={detect.isPending}
        onClick={() => detect.mutate(path)}
      >
        检测「{path || 'data_source'}」
      </button>
      {detect.error && <ErrorNotice error={apiErrorOf(detect.error)} />}
      {detect.data && detect.data.path === path && (
        <DetectView
          key={JSON.stringify(detect.data)}
          result={detect.data}
          onGo={go}
        />
      )}
    </section>
  )
}

function DetectView(
  { result, onGo }: { result: Detect; onGo: (path: string) => void },
) {
  const [kind, setKind] = useState<'tags-tree' | 'csv' | null>(
    result.kinds.length === 1 ? result.kinds[0] : null,
  )
  const { tagsTree, csv, scanned } = result

  return (
    <div className='mt-4'>
      <h3 className='title is-6'>检测结果</h3>
      {result.kinds.length === 0 && (
        <div className='notification is-warning is-light'>
          <p>
            这个目录里没找到完整的 tags-tree 文件，也没有能导入的 CSV（带 tag
            列）。
          </p>
          <p className='is-size-7 mt-1'>
            看过 {scanned.dirs} 个目录、{scanned.csvFiles} 个 CSV
            {scanned.truncated && '（目录太多，没有全部看完）'}。
          </p>
          {tagsTree && !tagsTree.complete && (
            <p className='is-size-7 mt-1'>
              像 tags-tree 仓库，但缺少：{tagsTree.missing.join('、')}
            </p>
          )}
          {result.treeRootPath !== null && (
            <p className='is-size-7 mt-1'>
              这是 tags-tree 仓库里的子目录，请选仓库根目录{' '}
              <button
                type='button'
                className='button is-small is-text p-0'
                onClick={() => onGo(result.treeRootPath!)}
              >
                {result.treeRootPath || 'data_source'} →
              </button>
            </p>
          )}
        </div>
      )}
      {result.kinds.length > 1 && (
        <div className='field'>
          <p className='mb-1'>这个目录两种格式都有，选择导入方式：</p>
          <div className='buttons has-addons'>
            {(['tags-tree', 'csv'] as const).map((k) => (
              <button
                type='button'
                key={k}
                className={`button${kind === k ? ' is-link is-selected' : ''}`}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {k === 'tags-tree'
                  ? 'tags-tree（重新生成词库）'
                  : 'CSV（附加信息）'}
              </button>
            ))}
          </div>
        </div>
      )}
      {kind === 'tags-tree' && <TreeImport result={result} />}
      {kind === 'csv' && <CsvImport result={result} files={csv} />}
    </div>
  )
}

function SourceLine({ source }: { source: Detect['source'] }) {
  return (
    <p className='is-size-7 has-text-grey mb-2'>
      来源 {source.name} · <code>{short(source.revision)}</code>
      {source.dirty && '（有未提交的修改）'} · {source.license || '无许可信息'}
      {source.repository && ` · ${source.repository}`}
    </p>
  )
}

function useImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: runImport,
    onSuccess: () => {
      // 词库换了：状态、检索结果都重新取
      qc.invalidateQueries({ queryKey: ['tagloom', 'catalog'] })
      qc.invalidateQueries({ queryKey: adminKeys.status })
    },
  })
}

function TreeImport({ result }: { result: Detect }) {
  const run = useImport()
  const [confirm, setConfirm] = useState(false)
  const needConfirm = result.current.csvImports > 0
  return (
    <div>
      <p className='mb-1'>
        <span className='tag is-success is-light mr-2'>tags-tree 仓库</span>
        从这个仓库从头生成词库。
      </p>
      <SourceLine source={result.source} />
      <ul className='is-size-7 mb-2'>
        {result.tagsTree!.files.map((f) => (
          <li key={f.path}>
            <code>{f.path}</code> · {size(f.bytes)}
          </li>
        ))}
      </ul>
      {needConfirm && (
        <div className='notification is-warning is-light py-2'>
          <label className='checkbox'>
            <input
              type='checkbox'
              className='mr-2'
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            重新生成会清空已导入的 {result.current.csvImports}{' '}
            次 CSV，需要的话之后再导入一次。我已了解
          </label>
        </div>
      )}
      <button
        type='button'
        className={`button is-primary${run.isPending ? ' is-loading' : ''}`}
        disabled={run.isPending || (needConfirm && !confirm)}
        onClick={() =>
          run.mutate({
            path: result.path,
            kind: 'tags-tree',
            dropCsv: needConfirm ? confirm : undefined,
          })}
      >
        {result.current.hasTree ? '重新生成词库' : '生成词库'}
      </button>
      {run.isPending && <Pending />}
      {run.error && <ErrorNotice error={apiErrorOf(run.error)} />}
      {run.data && <Report result={run.data} />}
    </div>
  )
}

function CsvImport({ result, files }: { result: Detect; files: CsvFile[] }) {
  const run = useImport()
  const [picked, setPicked] = useState(
    () => new Set(files.filter((f) => f.selected).map((f) => f.path)),
  )
  const [name, setName] = useState(result.source.name)
  const [dataVersion, setDataVersion] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const chosen = files.filter((f) => picked.has(f.path))
  const repos = new Set(chosen.map((f) => f.repo))
  const toggle = (path: string) => {
    const next = new Set(picked)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setPicked(next)
  }

  return (
    <div>
      <p className='mb-1'>
        <span className='tag is-success is-light mr-2'>标签 CSV</span>
        作为附加信息导入：只写 CSV 的列，后导入的覆盖先导入的，空值不覆盖。
      </p>
      <SourceLine source={result.source} />
      {!result.current.hasTree && (
        <div className='notification is-warning is-light py-2'>
          词库还没有从 tags-tree 生成，先导入 tags-tree 才能导入 CSV。
        </div>
      )}
      <div className='table-container'>
        <table className='table is-fullwidth is-narrow is-size-7'>
          <thead>
            <tr>
              <th>导入</th>
              <th>文件</th>
              <th>格式</th>
              <th>行数</th>
              <th>大小</th>
              <th>提醒</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => {
              const ok = IMPORTABLE.has(f.status)
              const [cls, label] = STATUS_LABEL[f.status]
              return (
                <tr key={f.path}>
                  <td>
                    <input
                      type='checkbox'
                      aria-label={`导入 ${f.path}`}
                      disabled={!ok}
                      checked={picked.has(f.path)}
                      onChange={() => toggle(f.path)}
                    />
                  </td>
                  <td>
                    <code>{f.path}</code>
                  </td>
                  <td>
                    <span
                      className={`tag ${cls}`}
                      title={[
                        f.header.length ? `表头：${f.header.join(',')}` : '',
                        f.unknownColumns.length
                          ? `导入时忽略：${f.unknownColumns.join('、')}`
                          : '',
                        f.status === 'tag-only'
                          ? '只有标签名：只会新建词库里没有的标签'
                          : '',
                      ].filter(Boolean).join('\n') || undefined}
                    >
                      {label}
                    </span>
                  </td>
                  <td>{f.rows === null ? '-' : f.rows.toLocaleString()}</td>
                  <td>{size(f.bytes)}</td>
                  <td>
                    {f.warnings.length > 0 && (
                      <button
                        type='button'
                        className='button is-text is-small p-0'
                        onClick={() =>
                          setShown(shown === f.path ? null : f.path)}
                      >
                        {f.warnings.length} 条
                      </button>
                    )}
                    {shown === f.path && (
                      <ul>
                        {f.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {repos.size > 1 && (
        <div className='notification is-warning is-light py-2 is-size-7'>
          勾选的文件来自不同的仓库（{[...repos].map((r) => r || '不是仓库')
            .join('、')}），导入记录只能记一个来源，建议分别导入。
        </div>
      )}
      <div className='columns is-variable is-2'>
        <div className='column'>
          <label className='label is-small' htmlFor='catalog-source-name'>
            来源名
          </label>
          <input
            id='catalog-source-name'
            className='input is-small'
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className='column'>
          <label className='label is-small' htmlFor='catalog-data-version'>
            数据版本（可不填）
          </label>
          <input
            id='catalog-data-version'
            className='input is-small'
            value={dataVersion}
            maxLength={200}
            placeholder='如 2026-08'
            onChange={(e) => setDataVersion(e.target.value)}
          />
        </div>
      </div>
      <button
        type='button'
        className={`button is-primary${run.isPending ? ' is-loading' : ''}`}
        disabled={run.isPending || !chosen.length || !result.current.hasTree}
        onClick={() =>
          run.mutate({
            path: result.path,
            kind: 'csv',
            files: chosen.map((f) => f.path),
            name,
            dataVersion,
          })}
      >
        导入 {chosen.length} 个文件
      </button>
      {run.isPending && <Pending />}
      {run.error && <ErrorNotice error={apiErrorOf(run.error)} />}
      {run.data && <Report result={run.data} />}
    </div>
  )
}

function Pending() {
  return (
    <p className='is-size-7 has-text-grey mt-2'>
      导入中…完成后会自动重新加载词库，这期间检索会暂停几秒。
    </p>
  )
}

function Report({ result }: { result: ImportResult }) {
  const { tree, csv, reload } = result
  return (
    <div className='notification is-success is-light mt-3'>
      <p className='has-text-weight-semibold'>
        导入完成（{(result.ms / 1000).toFixed(1)} 秒）
      </p>
      {tree && (
        <>
          <p>
            分类 {tree.categories.toLocaleString()} · 标签{' '}
            {tree.tags.toLocaleString()} · 受限 {tree.restricted}
          </p>
          {tree.droppedImports > 0 && (
            <p>已清空原来的 {tree.droppedImports} 次 CSV 导入。</p>
          )}
        </>
      )}
      {csv && (
        <>
          <p>
            导入记录第 {csv.seq} 次 · 来源 {csv.source.name}
          </p>
          <p>
            新建标签 {csv.created.toLocaleString()} · 补充已有标签{' '}
            {csv.updated.toLocaleString()} · 新增别名{' '}
            {csv.aliasesAdded.toLocaleString()}
          </p>
          <p>
            词库现有标签 {csv.tagCount.toLocaleString()} · 别名{' '}
            {csv.aliasCount.toLocaleString()}
          </p>
        </>
      )}
      {(tree?.warnings ?? csv?.warnings ?? []).length > 0 && (
        <details className='mt-1'>
          <summary>
            提醒 {(tree?.warnings ?? csv?.warnings ?? []).length} 条
          </summary>
          <ul className='is-size-7'>
            {(tree?.warnings ?? csv?.warnings ?? []).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <p className='mt-1'>
        {reload.reason || !reload.status.available
          ? `⚠ 重新加载词库失败，继续使用原来的词库：${reload.reason}`
          : `已重新加载词库：标签 ${reload.status.tagCount.toLocaleString()}`}
      </p>
    </div>
  )
}
