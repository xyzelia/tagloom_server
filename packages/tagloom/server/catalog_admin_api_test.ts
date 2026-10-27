// 词库页的接口：浏览数据源目录、检测、导入（tags-tree / CSV），导入后不用重启就能检索到。
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { closeTagloomRuntime, tagloomPlugin } from './mod.ts'
import { referencedCategoryPaths } from '../share/mod.ts'
import {
  FREQUENCY_FILE,
  MULTILINGUAL_FILE,
  TREE_FILE,
} from '../catalog-import/tags-tree.ts'

type Req = (path: string, init?: RequestInit) => Promise<Response>

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// 包含代码用到的全部分类路径的最小分类树：每个分类下一个标签
function treeYaml(): string {
  type Node = Map<string, Node>
  const root: Node = new Map()
  for (const path of referencedCategoryPaths()) {
    let node = root
    for (const seg of path.split('.')) {
      if (!node.has(seg)) node.set(seg, new Map())
      node = node.get(seg)!
    }
  }
  const lines = ["_meta:\n  version: '1'"]
  const walk = (node: Node, path: string[], indent: string) => {
    for (const [seg, child] of node) {
      const p = [...path, seg]
      lines.push(`${indent}${seg}:`)
      lines.push(`${indent}  _tags:`)
      lines.push(`${indent}  - t_${p.join('_')}`)
      walk(child, p, `${indent}  `)
    }
  }
  walk(root, [], '')
  return lines.join('\n') + '\n'
}

async function withApp(fn: (req: Req, sources: string) => Promise<void>) {
  const dir = (await Deno.makeTempDir({ prefix: 'tagloom_admin_' }))
    .replaceAll('\\', '/')
  closeTagloomRuntime()
  const sources = `${dir}/data_source`
  const plugin = tagloomPlugin({
    dataDir: `${dir}/tagloom`,
    sourceDir: sources,
  })
  const app = new Hono().route('/api/tagloom', plugin.api)
  const req: Req = (path, init) =>
    Promise.resolve(app.request(`/api/tagloom${path}`, init))
  try {
    await Deno.mkdir(`${dir}/tagloom`, { recursive: true })
    const tree = `${sources}/repos/tags-tree`
    await Deno.mkdir(`${tree}/data/source`, { recursive: true })
    await Deno.writeTextFile(`${tree}/${TREE_FILE}`, treeYaml())
    await Deno.writeTextFile(`${tree}/${MULTILINGUAL_FILE}`, '{}\n')
    await Deno.writeTextFile(`${tree}/${FREQUENCY_FILE}`, 'tag,count\n')
    await Deno.mkdir(`${sources}/zh/tags`, { recursive: true })
    await Deno.writeTextFile(
      `${sources}/zh/tags/general.csv`,
      'tag,category,aliases,zh,count,notes\nzzunique_tag,0,zz_alias,独特标签,10,只在测试里出现的说明\n',
    )
    await Deno.writeTextFile(
      `${sources}/zh/tags/artist.csv`,
      'tag,category,aliases,zh,count,notes\nsome_artist,1,,,5,\n',
    )
    await Deno.writeTextFile(`${sources}/zh/other.csv`, 'name\nx\n')
    await fn(req, sources)
  } finally {
    closeTagloomRuntime()
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test('catalog admin: browse, detect, import tags-tree then CSV, searchable without restart', async () => {
  await withApp(async (req) => {
    let status = await (await req('/catalog/admin/status')).json()
    assert.equal(status.file, null)
    assert.equal(status.imports, null)
    assert.equal(status.sourceDirExists, true)
    assert.equal(status.catalog.available, false)

    const root = await (await req('/catalog/admin/dirs')).json()
    assert.deepEqual(root.dirs.map((d: { path: string }) => d.path), [
      'repos',
      'zh',
    ])
    const repos = await (await req('/catalog/admin/dirs?path=repos')).json()
    assert.deepEqual(repos.dirs, [{
      name: 'tags-tree',
      path: 'repos/tags-tree',
    }])

    // tags-tree
    const tree = await (await req(
      '/catalog/admin/detect',
      json({ path: 'repos/tags-tree' }),
    )).json()
    assert.deepEqual(tree.kinds, ['tags-tree'])
    assert.equal(tree.current.hasTree, false)
    assert.equal(tree.source.name, 'tags-tree')
    // 选到仓库里的 data/source：提示改选仓库根目录
    const sub = await (await req(
      '/catalog/admin/detect',
      json({ path: 'repos/tags-tree/data/source' }),
    )).json()
    assert.deepEqual(sub.kinds, [])
    assert.equal(sub.treeRootPath, 'repos/tags-tree')

    let res = await req(
      '/catalog/admin/import',
      json({ path: 'repos/tags-tree', kind: 'tags-tree' }),
    )
    assert.equal(res.status, 200)
    const first = await res.json()
    assert.equal(first.reload.reason, '')
    assert.equal(first.reload.status.available, true)
    assert.equal(first.tree.droppedImports, 0)
    const catStatus = await (await req('/catalog/status')).json()
    assert.equal(catStatus.available, true)

    // CSV：子目录里的文件，画师默认不勾，没有 tag 列的不能导入
    const zh = await (await req('/catalog/admin/detect', json({ path: 'zh' })))
      .json()
    assert.deepEqual(zh.kinds, ['csv'])
    assert.equal(zh.current.hasTree, true)
    const files = new Map(
      zh.csv.map((f: { path: string }) => [f.path, f]),
    ) as Map<string, { status: string; selected: boolean }>
    assert.equal(files.get('tags/general.csv')!.selected, true)
    assert.equal(files.get('tags/artist.csv')!.selected, false)
    assert.equal(files.get('other.csv')!.status, 'no-tag')

    res = await req(
      '/catalog/admin/import',
      json({ path: 'zh', kind: 'csv', files: ['other.csv'] }),
    )
    assert.equal(res.status, 422)
    assert.match((await res.json()).message, /不能导入/)

    res = await req(
      '/catalog/admin/import',
      json({
        path: 'zh',
        kind: 'csv',
        files: ['tags/general.csv'],
        name: 'ame-la',
        dataVersion: '2026-08',
      }),
    )
    assert.equal(res.status, 200)
    const csv = await res.json()
    assert.equal(csv.csv.seq, 2)
    assert.equal(csv.csv.created, 1)
    assert.equal(csv.csv.source.name, 'ame-la')
    assert.equal(csv.reload.reason, '')

    // 不用重启：新标签、别名、说明都能检索到
    const search = async (q: string) =>
      (await (await req(`/catalog/search?${new URLSearchParams({ q })}`))
        .json()).items.map((h: { canonical: string }) => h.canonical)
    assert.deepEqual(await search('zzunique'), ['zzunique tag'])
    assert.deepEqual(await search('独特标签'), ['zzunique tag'])
    assert.deepEqual(await search('测试里出现'), ['zzunique tag'])

    status = await (await req('/catalog/admin/status')).json()
    assert.equal(status.file, 'tag_catalog.sqlite')
    assert.deepEqual(
      status.imports.map((g: { seq: number; kind: string }) => [g.seq, g.kind]),
      [[1, 'tags-tree'], [2, 'csv']],
    )
    // 导入记录里只有相对路径
    assert.deepEqual(
      status.imports[1].files.map((f: { path: string }) => f.path),
      [
        'tags/general.csv',
      ],
    )
    assert.equal(status.imports[1].name, 'ame-la')
    assert.equal(status.imports[1].dataVersion, '2026-08')
    assert.ok(!JSON.stringify(status).includes('tagloom_admin_'))

    // 重新生成 tags-tree 会清空 CSV：要先确认
    res = await req(
      '/catalog/admin/import',
      json({ path: 'repos/tags-tree', kind: 'tags-tree' }),
    )
    assert.equal(res.status, 422)
    assert.match((await res.json()).message, /清空已导入的 CSV/)
    res = await req(
      '/catalog/admin/import',
      json({ path: 'repos/tags-tree', kind: 'tags-tree', dropCsv: true }),
    )
    assert.equal(res.status, 200)
    assert.equal((await res.json()).tree.droppedImports, 1)
    assert.deepEqual(await search('zzunique'), [])
  })
})

Deno.test('catalog admin: refuses paths outside the data source folder and concurrent imports', async () => {
  await withApp(async (req) => {
    for (const path of ['../tagloom', '/etc', 'C:/Windows', 'zh/../..']) {
      const res = await req('/catalog/admin/detect', json({ path }))
      assert.equal(res.status, 422, path)
    }
    const res = await req('/catalog/admin/dirs?path=nope')
    assert.equal(res.status, 422)
    assert.match((await res.json()).message, /目录不存在/)

    // CSV 要在 tags-tree 之后导入；出错信息里不带本机路径
    const csv = await req(
      '/catalog/admin/import',
      json({ path: 'zh', kind: 'csv', files: ['tags/general.csv'] }),
    )
    assert.equal(csv.status, 422)
    const body = await csv.json()
    assert.match(body.message, /词库不存在/)
    assert.ok(!body.message.includes('tagloom_admin_'))

    // 同时两个导入：第二个被拒绝
    const both = await Promise.all([
      req(
        '/catalog/admin/import',
        json({ path: 'repos/tags-tree', kind: 'tags-tree' }),
      ),
      req(
        '/catalog/admin/import',
        json({ path: 'repos/tags-tree', kind: 'tags-tree' }),
      ),
    ])
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409])
    for (const r of both) await r.body?.cancel()
  })
})

Deno.test('catalog admin: creates an empty data source folder on first visit', async () => {
  const dir = (await Deno.makeTempDir({ prefix: 'tagloom_admin_' }))
    .replaceAll('\\', '/')
  closeTagloomRuntime()
  const plugin = tagloomPlugin({
    dataDir: `${dir}/tagloom`,
    sourceDir: `${dir}/data_source`,
  })
  const app = new Hono().route('/api/tagloom', plugin.api)
  try {
    const before =
      await (await app.request('/api/tagloom/catalog/admin/status'))
        .json()
    assert.equal(before.sourceDirExists, false)
    const res = await app.request('/api/tagloom/catalog/admin/dirs')
    assert.equal(res.status, 200)
    assert.deepEqual((await res.json()).dirs, [])
    assert.ok((await Deno.stat(`${dir}/data_source`)).isDirectory)
  } finally {
    closeTagloomRuntime()
    await Deno.remove(dir, { recursive: true })
  }
})
