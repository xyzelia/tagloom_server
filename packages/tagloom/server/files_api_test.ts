import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { closeTagloomRuntime, tagloomPlugin } from './mod.ts'
import { type Character, emptyContent } from '../share/mod.ts'

async function withFiles(
  fn: (
    req: (path: string, init?: RequestInit) => Promise<Response>,
    root: string,
  ) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: 'tagloom_files_' })
  closeTagloomRuntime()
  const plugin = tagloomPlugin({ dataDir: dir, catalogPath: 'missing.sqlite' })
  const app = new Hono().route('/api/tagloom', plugin.api)
  const req = (path: string, init?: RequestInit) =>
    Promise.resolve(app.request(`/api/tagloom${path}`, init))
  try {
    await fn(req, `${dir}/characters`)
  } finally {
    closeTagloomRuntime()
    await Deno.remove(dir, { recursive: true })
  }
}
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const preview = (path: string) =>
  `/files/preview?${new URLSearchParams({ path })}`
const list = (folder: string) => `/files?${new URLSearchParams({ folder })}`

Deno.test('character file browser scans disk folders and naturally sorts JSON files', async () => {
  await withFiles(async (req, root) => {
    assert.deepEqual(await (await req('/files')).json(), {
      folder: '',
      entries: [],
    })
    await Deno.mkdir(`${root}/人物 空格/子文件夹`, { recursive: true })
    await Deno.mkdir(`${root}/空目录`)
    await Deno.mkdir(`${root}/.hidden`)
    for (
      const name of [
        '人物10.json',
        '人物2.JSON',
        'ignore.txt',
        '.hidden.json',
        'temp.json.tmp',
      ]
    ) {
      await Deno.writeTextFile(`${root}/${name}`, '{}')
    }
    await Deno.writeTextFile(
      `${root}/人物 空格/子文件夹/a #&%.json`,
      JSON.stringify(emptyContent()),
    )
    const response = await req('/files')
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(result.entries.map((e: { kind: string }) => e.kind), [
      'folder',
      'folder',
      'file',
      'file',
    ])
    assert.deepEqual(
      result.entries.filter((e: { kind: string }) => e.kind === 'file').map((
        e: { name: string },
      ) => e.name),
      ['人物2.JSON', '人物10.json'],
    )
    assert.equal(result.entries[2].bytes, 2)
    assert.ok(result.entries[2].modifiedAt)
    const nested = await (await req(list('人物 空格/子文件夹'))).json()
    assert.equal(nested.entries[0].path, '人物 空格/子文件夹/a #&%.json')
    assert.equal((await req(preview(nested.entries[0].path))).status, 200)
    assert.deepEqual((await (await req(list('空目录'))).json()).entries, [])
    await Deno.writeTextFile(`${root}/new.json`, '{}')
    assert.equal((await (await req('/files')).json()).entries.length, 5)
    await Deno.remove(`${root}/new.json`)
    assert.equal((await (await req('/files')).json()).entries.length, 4)
    // 外部 JSON 只出现在文件浏览器，不应破坏人物编辑列表。
    const managed = await req('/characters')
    assert.equal(managed.status, 200)
    const listing = await managed.json()
    assert.deepEqual(listing.characters, [])
    assert.equal(listing.otherFiles, 2)
    assert.deepEqual(
      listing.folders.map((f: { name: string }) => f.name),
      ['空目录', '人物 空格'],
    )
  })
})

Deno.test('character file preview supports raw characters, project v2 and invalid/other JSON', async () => {
  await withFiles(async (req, root) => {
    await req('/files')
    const content = {
      ...emptyContent(),
      title: '人物A',
      profile: '设定\n第二行',
    }
    const cases = [
      ['raw.json', JSON.stringify(content), 'character'],
      [
        'project.json',
        JSON.stringify({
          format: 'tagloom.project',
          formatVersion: 2,
          character: content,
        }),
        'project',
      ],
      [
        'old.json',
        JSON.stringify({
          format: 'tagloom.project',
          formatVersion: 1,
          character: content,
        }),
        'json',
      ],
      [
        'output.json',
        JSON.stringify({ format: 'tagloom.output', ...content }),
        'json',
      ],
      ['other.json', '{"hello":true}', 'json'],
      ['array.json', '[]', 'json'],
      ['null.json', 'null', 'json'],
      ['bad.json', '{broken', 'invalid'],
    ]
    for (const [path, text, kind] of cases) {
      await Deno.writeTextFile(`${root}/${path}`, text)
      const response = await req(preview(path))
      assert.equal(response.status, 200)
      const file = await response.json()
      assert.equal(file.kind, kind)
      assert.equal(file.text, text)
      assert.equal(
        file.summary?.title ?? null,
        ['character', 'project'].includes(kind) ? '人物A' : null,
      )
      assert.ok(!('content' in file))
      if (!['character', 'project'].includes(kind)) {
        assert.equal((await req('/files/import', post({ path }))).status, 422)
      }
    }
  })
})

Deno.test('character disk imports re-read the source, create new IDs and never overwrite files', async () => {
  await withFiles(async (req, root) => {
    await req('/files')
    await Deno.mkdir(`${root}/嵌套`)
    const path = '嵌套/source.json'
    const original = {
      ...emptyContent(),
      title: '预览时的名字',
      id: 'original',
    }
    await Deno.writeTextFile(`${root}/${path}`, JSON.stringify(original))
    assert.equal(
      (await (await req(preview(path))).json()).summary.title,
      original.title,
    )
    const latest = JSON.stringify({ ...original, title: '硬盘上的最新名字' })
    await Deno.writeTextFile(`${root}/${path}`, latest)
    const response = await req('/files/import', post({ path }))
    assert.equal(response.status, 201)
    const imported = await response.json() as Character
    // 建在源文件所在的文件夹，文件名取自标题
    assert.equal(imported.path, '嵌套/硬盘上的最新名字.json')
    assert.equal(imported.title, '硬盘上的最新名字')
    assert.equal(imported.version, 1)
    assert.deepEqual(imported.agentChanges, [])
    assert.equal(await Deno.readTextFile(`${root}/${path}`), latest)
    assert.equal(
      (await req(`/characters/item?path=${encodeURIComponent(imported.path)}`))
        .status,
      200,
    )
    const archive = await (await req(
      `/characters/item/export/project?path=${
        encodeURIComponent(imported.path)
      }`,
    )).json()
    await Deno.writeTextFile(
      `${root}/嵌套/archive.json`,
      JSON.stringify(archive),
    )
    const second =
      await (await req('/files/import', post({ path: '嵌套/archive.json' })))
        .json()
    assert.notEqual(second.path, imported.path)
    assert.deepEqual(second.base, imported.base)
    assert.equal((await (await req('/characters/search')).json()).length, 2)
    await Deno.remove(`${root}/${path}`)
    assert.equal((await req('/files/import', post({ path }))).status, 404)
  })
})

Deno.test('character file API rejects traversal, absolute paths, bad extensions and missing files', async () => {
  await withFiles(async (req, root) => {
    await req('/files')
    await Deno.writeTextFile(`${root}/data.json`, '{}')
    await Deno.mkdir(`${root}/folder.json`)
    const bad = [
      '../data.json',
      '/etc/passwd.json',
      'a/../data.json',
      './data.json',
      'a//data.json',
      'a\\data.json',
      'C:/data.json',
      'bad\u0000.json',
    ]
    for (const path of bad) {
      assert.equal((await req(list(path))).status, 422, path)
      assert.equal((await req(preview(path))).status, 422, path)
      assert.equal(
        (await req('/files/import', post({ path }))).status,
        422,
        path,
      )
    }
    assert.equal((await req(preview('data.txt'))).status, 422)
    assert.equal((await req(preview('missing.json'))).status, 404)
    assert.equal((await req(list('missing'))).status, 404)
    assert.equal((await req(list('data.json'))).status, 404)
    assert.equal((await req(preview('folder.json'))).status, 404)
    assert.equal((await req('/files/import', post({}))).status, 422)
  })
})

Deno.test('character browser hides and refuses symlinks, including folder loops', async () => {
  await withFiles(async (req, root) => {
    await req('/files')
    await Deno.mkdir(`${root}/safe`)
    await Deno.writeTextFile(`${root}/safe/data.json`, '{}')
    await Deno.writeTextFile(`${root}/../outside.json`, 'secret')
    await Deno.symlink('../outside.json', `${root}/escape.json`)
    await Deno.symlink('safe/data.json', `${root}/inside.json`)
    await Deno.symlink('..', `${root}/safe/loop`)
    await Deno.symlink('safe', `${root}/alias`)
    const result = await (await req('/files')).json()
    assert.deepEqual(result.entries.map((e: { name: string }) => e.name), [
      'safe',
    ])
    for (
      const path of [
        'escape.json',
        'inside.json',
        'alias/data.json',
        'safe/loop/safe/data.json',
      ]
    ) {
      assert.equal((await req(preview(path))).status, 404)
      assert.equal((await req('/files/import', post({ path }))).status, 404)
    }
    assert.equal((await req(list('safe/loop'))).status, 404)
    assert.equal((await req(list('alias'))).status, 404)
  })
})

Deno.test('character preview and import enforce the 8 MiB limit without breaking listing', async () => {
  await withFiles(async (req, root) => {
    await req('/files')
    const file = await Deno.open(`${root}/huge.json`, {
      create: true,
      write: true,
    })
    try {
      await file.truncate(8 * 1024 * 1024 + 1)
    } finally {
      file.close()
    }
    assert.equal(
      (await (await req('/files')).json()).entries[0].bytes,
      8 * 1024 * 1024 + 1,
    )
    assert.equal((await req(preview('huge.json'))).status, 422)
    assert.equal(
      (await req('/files/import', post({ path: 'huge.json' }))).status,
      422,
    )
  })
})
