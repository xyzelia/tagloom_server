import assert from 'node:assert/strict'
import { detectSource } from './detect.ts'
import {
  listSourceDirs,
  normalizeSourcePath,
  resolveSourceDir,
} from './source-dir.ts'
import { FREQUENCY_FILE, MULTILINGUAL_FILE, TREE_FILE } from './tags-tree.ts'

const HEADER = 'tag,category,aliases,zh,count,notes\n'

async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir()
  try {
    await fn(dir.replaceAll('\\', '/'))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

async function write(path: string, text: string | Uint8Array) {
  await Deno.mkdir(path.split('/').slice(0, -1).join('/'), { recursive: true })
  if (typeof text === 'string') await Deno.writeTextFile(path, text)
  else await Deno.writeFile(path, text)
}

async function treeRepo(dir: string, files = [TREE_FILE, MULTILINGUAL_FILE]) {
  for (const f of files) await write(`${dir}/${f}`, '_meta: {}\n')
  await write(`${dir}/${FREQUENCY_FILE}`, 'tag,count\nblue_hair,1\n')
}

Deno.test('detect: tags-tree repo; its frequency CSV is not a CSV source', async () => {
  await withDir(async (dir) => {
    await treeRepo(dir)
    const r = await detectSource(dir)
    assert.deepEqual(r.kinds, ['tags-tree'])
    assert.equal(r.tagsTree?.complete, true)
    assert.equal(r.tagsTree?.files.length, 3)
    assert.deepEqual(r.csv, [])
  })
})

Deno.test('detect: partial tags-tree and the data/source subfolder hint', async () => {
  await withDir(async (dir) => {
    await treeRepo(dir, [TREE_FILE])
    const r = await detectSource(dir)
    assert.deepEqual(r.kinds, [])
    assert.equal(r.tagsTree?.complete, false)
    assert.deepEqual(r.tagsTree?.missing, [MULTILINGUAL_FILE])
    const sub = await detectSource(`${dir}/data/source`)
    assert.equal(sub.tagsTree, null)
    assert.equal(sub.treeRootHint, '../..')
    assert.deepEqual(sub.csv, [])
  })
})

Deno.test('detect: CSV files in nested folders, statuses and default selection', async () => {
  await withDir(async (dir) => {
    await write(`${dir}/tags/general.csv`, HEADER + 'blue_hair,0,,蓝发,1,\n')
    await write(`${dir}/tags/artist.csv`, HEADER + 'someone,1,,,1,\n')
    await write(`${dir}/tags/deep/a/b/extra.csv`, 'tag,zh,rating\nx,y,z\n')
    await write(`${dir}/names.csv`, 'tag\nfoo\nbar\n')
    await write(`${dir}/other.csv`, 'name,zh\nx,y\n')
    await write(`${dir}/bad.csv`, new Uint8Array([0x74, 0x61, 0x67, 0xff]))
    await write(`${dir}/.git/hidden.csv`, HEADER)
    await write(`${dir}/node_modules/x/y.csv`, HEADER)
    const r = await detectSource(dir)
    assert.deepEqual(r.kinds, ['csv'])
    const by = new Map(r.csv.map((f) => [f.path, f]))
    assert.deepEqual([...by.keys()].sort(), [
      'bad.csv',
      'names.csv',
      'other.csv',
      'tags/artist.csv',
      'tags/deep/a/b/extra.csv',
      'tags/general.csv',
    ])
    assert.equal(by.get('tags/general.csv')!.status, 'full')
    assert.equal(by.get('tags/general.csv')!.rows, 1)
    assert.equal(by.get('tags/general.csv')!.selected, true)
    assert.equal(by.get('tags/general.csv')!.folder, 'tags')
    // 画师默认不勾
    assert.equal(by.get('tags/artist.csv')!.status, 'full')
    assert.equal(by.get('tags/artist.csv')!.selected, false)
    const extra = by.get('tags/deep/a/b/extra.csv')!
    assert.equal(extra.status, 'extra')
    assert.deepEqual(extra.unknownColumns, ['rating'])
    assert.equal(extra.selected, false)
    assert.equal(by.get('names.csv')!.status, 'tag-only')
    assert.equal(by.get('names.csv')!.rows, 2)
    assert.equal(by.get('names.csv')!.selected, false)
    assert.equal(by.get('other.csv')!.status, 'no-tag')
    assert.deepEqual(by.get('other.csv')!.header, ['name', 'zh'])
    assert.equal(by.get('bad.csv')!.status, 'encoding')
  })
})

Deno.test('detect: both formats in one folder; nothing recognised', async () => {
  await withDir(async (dir) => {
    await treeRepo(`${dir}/tree`)
    await write(`${dir}/zh/tags/general.csv`, HEADER + 'a,0,,,1,\n')
    const r = await detectSource(dir)
    // 子目录里的 tags-tree 不算（要选到仓库根目录），它的频次文件也不算 CSV
    assert.deepEqual(r.kinds, ['csv'])
    assert.deepEqual(r.csv.map((f) => f.path), ['zh/tags/general.csv'])
    await treeRepo(`${dir}/zh`)
    const both = await detectSource(`${dir}/zh`)
    assert.deepEqual(both.kinds, ['tags-tree', 'csv'])
    assert.deepEqual(both.csv.map((f) => f.path), ['tags/general.csv'])
    await Deno.mkdir(`${dir}/empty`)
    const none = await detectSource(`${dir}/empty`)
    assert.deepEqual(none.kinds, [])
    assert.equal(none.scanned.dirs, 1)
  })
})

Deno.test('source dir: only relative paths inside the data source folder', async () => {
  await withDir(async (dir) => {
    await Deno.mkdir(`${dir}/root/a/b`, { recursive: true })
    await Deno.mkdir(`${dir}/root/.git`)
    await Deno.mkdir(`${dir}/outside`)
    const root = `${dir}/root`
    assert.equal(normalizeSourcePath('a/b/'), 'a/b')
    assert.throws(() => normalizeSourcePath('/a/b'))
    assert.equal(normalizeSourcePath('a\\b'), 'a/b')
    assert.throws(() => normalizeSourcePath('a/../b'))
    assert.throws(() => normalizeSourcePath('C:/x'))
    assert.throws(() => normalizeSourcePath('\\\\server\\x'))
    assert.equal((await resolveSourceDir(root, 'a/b')).rel, 'a/b')
    await assert.rejects(resolveSourceDir(root, 'nope'), /目录不存在/)
    await assert.rejects(resolveSourceDir(root, '../outside'))
    const list = await listSourceDirs(root, '')
    assert.deepEqual(list.dirs, [{ name: 'a', path: 'a' }])
    assert.deepEqual((await listSourceDirs(root, 'a')).dirs, [
      { name: 'b', path: 'a/b' },
    ])
    await assert.rejects(resolveSourceDir(`${dir}/missing`, ''), /不存在/)
  })
})
