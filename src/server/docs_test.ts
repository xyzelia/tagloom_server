import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createDocsApi, isSafeDocDir, isSafeDocPath } from './docs.ts'

async function withDocs(
  fn: (call: (url: string) => Promise<Response>, dir: string) => Promise<void>,
) {
  const dir = await Deno.makeTempDir()
  try {
    const docs = `${dir}/doc`
    for (const folder of ['guide/deep', '中文 目录', '.hidden']) {
      await Deno.mkdir(`${docs}/${folder}`, { recursive: true })
    }
    const write = (path: string, text: string) =>
      Deno.writeTextFile(`${docs}/${path}`, text)
    await write('README.md', '# 说明\n\n见 [指南](guide/setup.md)\n')
    await write('USAGE.md', '没有标题')
    await write('guide/setup.md', '前言\n\n# `安装` 步骤 #\n')
    await write('guide/README.md', '# 指南')
    await write('guide/deep/a10.md', '# A10')
    await write('guide/deep/a2.md', '# A2')
    await write('中文 目录/说明.md', '# 中文')
    await write('.hidden/z.md', '# 隐藏')
    await write('notes.txt', 'x')
    await Deno.writeTextFile(`${dir}/outside.md`, '# 外面')
    const app = new Hono().route(
      '/doc',
      createDocsApi([
        { name: 'demo', api: new Hono(), docsDir: docs },
        { name: 'nodocs', api: new Hono() },
      ]),
    )
    await fn((url) => Promise.resolve(app.request(url)), dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test('doc path checks', () => {
  for (const ok of ['README.md', 'guide/setup.md', '中文 目录/说明.md']) {
    assert.ok(isSafeDocPath(ok), ok)
  }
  for (
    const bad of [
      '',
      'a.txt',
      '../x.md',
      'a/../b.md',
      'a//b.md',
      '/abs.md',
      'C:/x.md',
      'a\\b.md',
      './a.md',
      '.hidden/z.md',
      'a\nb.md',
    ]
  ) {
    assert.equal(isSafeDocPath(bad), false, bad)
  }
  assert.ok(isSafeDocDir(''))
  assert.ok(isSafeDocDir('guide/deep'))
  for (const bad of ['..', 'guide/..', '.hidden', 'a//b', 'a\\b']) {
    assert.equal(isSafeDocDir(bad), false, bad)
  }
})

Deno.test('lists modules and directories with README first', () =>
  withDocs(async (call) => {
    assert.deepEqual(await (await call('/doc')).json(), { modules: ['demo'] })
    const root = await (await call('/doc/demo/')).json()
    // 中英文之间的先后取决于区域设置，只比较内容
    assert.deepEqual({ ...root, dirs: [...root.dirs].sort() }, {
      path: '',
      dirs: ['guide', '中文 目录'].sort(),
      files: [
        { name: 'README.md', title: '说明' },
        { name: 'USAGE.md', title: 'USAGE' },
      ],
    })
    assert.deepEqual(
      await (await call('/doc/demo')).json(),
      root,
      'without trailing slash',
    )
    const guide = await (await call('/doc/demo/guide/')).json()
    assert.deepEqual(guide, {
      path: 'guide/',
      dirs: ['deep'],
      files: [
        { name: 'README.md', title: '指南' },
        { name: 'setup.md', title: '安装 步骤' },
      ],
    })
    const deep = await (await call('/doc/demo/guide/deep')).json()
    assert.deepEqual(deep.files.map((f: { name: string }) => f.name), [
      'a2.md',
      'a10.md',
    ])
    const zh = await (await call(`/doc/demo/${encodeURI('中文 目录')}/`))
      .json()
    assert.deepEqual(zh.files, [{ name: '说明.md', title: '中文' }])
  }))

Deno.test('serves raw markdown and refuses everything else', () =>
  withDocs(async (call) => {
    const res = await call('/doc/demo/guide/setup.md')
    assert.equal(res.status, 200)
    assert.equal(
      res.headers.get('content-type'),
      'text/markdown; charset=utf-8',
    )
    assert.equal(await res.text(), '前言\n\n# `安装` 步骤 #\n')
    assert.equal(
      await (await call(`/doc/demo/${encodeURI('中文 目录/说明.md')}`)).text(),
      '# 中文',
    )

    const status = async (url: string) => (await call(url)).status
    assert.equal(await status('/doc/demo/missing.md'), 404)
    assert.equal(await status('/doc/demo/missing/'), 404)
    assert.equal(await status('/doc/demo/README.md/'), 404)
    assert.equal(await status('/doc/nodocs/README.md'), 404)
    assert.equal(await status('/doc/demo/notes.txt'), 404)
    assert.equal(await status('/doc/demo/.hidden/z.md'), 404)
    assert.equal(await status('/doc/demo/.hidden/'), 404)
    assert.equal(await status('/doc/demo/%2E%2E/outside.md'), 404)
    assert.equal(await status('/doc/demo/guide%5C..%5C..%5Coutside.md'), 404)
  }))

Deno.test('does not follow symlinks out of the docs folder', () =>
  withDocs(async (call, dir) => {
    try {
      await Deno.symlink(`${dir}/outside.md`, `${dir}/doc/link.md`)
    } catch {
      // Windows 没有创建符号链接的权限时跳过
      return
    }
    assert.equal((await call('/doc/demo/link.md')).status, 404)
  }))
