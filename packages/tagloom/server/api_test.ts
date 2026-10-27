// 按宿主同样的方式挂载（/api/tagloom），用临时目录存人物 JSON。
// 真实词库测试只在 data/tagloom/tag_catalog.sqlite 存在时运行。
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { closeTagloomRuntime, tagloomPlugin } from './mod.ts'
import {
  addCustomTag,
  addFact,
  addTextItem,
  applySearch,
  assembleCombo,
  type Character,
  createCustomTag,
  decideCandidate,
  emptySegment,
  pickCatalogTag,
  pickCustomTag,
  setFactLocked,
  setIncluded,
} from '../share/mod.ts'

const REAL_CATALOG = new URL(
  '../../../data/tagloom/tag_catalog.sqlite',
  import.meta.url,
)
const hasRealCatalog = (() => {
  try {
    return Deno.statSync(REAL_CATALOG).isFile
  } catch {
    return false
  }
})()

async function withApp(
  catalogPath: string,
  fn: (
    req: (path: string, init?: RequestInit) => Promise<Response>,
    dir: string,
  ) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: 'tagloom_' })
  closeTagloomRuntime()
  const plugin = tagloomPlugin({ dataDir: dir, catalogPath })
  const app = new Hono().basePath('/api').route(`/${plugin.name}`, plugin.api)
  const req = (path: string, init?: RequestInit) =>
    Promise.resolve(app.request(`/api/tagloom${path}`, init))
  try {
    await fn(req, dir)
  } finally {
    closeTagloomRuntime()
    await Deno.remove(dir, { recursive: true })
  }
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

Deno.test('project archive round-trips all edit data into a new character', async () => {
  await withApp('missing.sqlite', async (req, dir) => {
    const created = await (await req('/characters', json({})))
      .json() as Character
    assert.equal(created.version, 1)
    // 存成 JSON 文件
    assert.ok(Deno.statSync(`${dir}/characters/${created.path}`).isFile)

    // 编辑：档案、词库条目、自创标签（人工 + AI）、事实 + 确认 + 锁定、字段状态、未勾选条目、权重、发型覆盖
    let c = structuredClone(created)
    c.profile = '蓝色长发，齐刘海'
    const mine = createCustomTag({
      text: 'star-shaped ahoge',
      label: '星形呆毛',
    }, { origin: 'user' })
    const ai = createCustomTag({ text: 'glowing tattoo' }, {
      origin: 'agent',
      agentName: 'test-agent',
    })
    c = { ...c, ...addCustomTag(addCustomTag(c, mine), ai) }
    let hair = pickCatalogTag(c.base.segments.hair, 'hair_color', {
      canonical: 'blue hair',
      labelZh: '蓝发',
      categoryPath: 'character.body.hair.color',
      catalogVersion: 'v3@x',
    })
    hair = pickCustomTag(hair, 'hair_extra_structure', mine)
    hair = setIncluded(hair, hair.items[1].id, false)
    hair = addFact(hair, {
      field: 'bangs_shape',
      text: '齐刘海',
      sourceQuote: '齐刘海',
    })
    const fid = hair.facts[0].id
    hair = applySearch(
      hair,
      fid,
      [{
        canonical: 'blunt bangs',
        labelZh: '齐刘海',
        labelEn: '',
        labelJa: '',
        aliases: [],
        postCount: 1,
        notes: '',
        categoryPath: 'character.body.hair.bangs',
        categoryLabelZh: '刘海',
        sources: [],
        match: 'label',
        evidence: '齐刘海',
        inField: true,
      }],
      'v3@x',
      1_000,
    )
    hair = decideCandidate(
      hair,
      fid,
      hair.facts[0].candidates[0].id,
      'confirmed',
    )
    hair = setFactLocked(hair, fid, true)
    hair.fieldStates = { sidelock: 'na' }
    hair = addTextItem(hair, '(long hair:1.2)')
    c.base.segments.hair = hair
    c.base.segments.other = pickCustomTag(c.base.segments.other, null, ai)
    c.combos[0].hairOverride = {
      enabled: true,
      segment: addTextItem(emptySegment(), 'ponytail'),
    }
    const { path, version, createdAt: _a, updatedAt: _b, ...content } = c
    const saved = await (await req(
      `/characters/item?path=${encodeURIComponent(path)}`,
      json({ expectedVersion: version, content }, 'PUT'),
    ))
      .json() as Character
    assert.equal(saved.version, 2)

    const exp = await req(
      `/characters/item/export/project?path=${encodeURIComponent(path)}`,
    )
    assert.match(exp.headers.get('content-disposition') ?? '', /attachment/)
    const archive = await exp.json()
    assert.equal(archive.format, 'tagloom.project')

    const imported = await (await req('/characters/import', json({ archive })))
      .json() as Character
    assert.notEqual(imported.path, path)
    // 文件名取自导入内容的标题（这里是档案第一行）
    assert.equal(imported.path, '蓝色长发，齐刘海.json')
    assert.equal(imported.version, 1)
    assert.deepEqual(imported.base, saved.base)
    assert.deepEqual(imported.customTags, saved.customTags)
    assert.deepEqual(
      imported.customTags.map((t) => [t.text, t.origin, t.agentName]),
      [['star-shaped ahoge', 'user', ''], [
        'glowing tattoo',
        'agent',
        'test-agent',
      ]],
    )
    assert.equal(
      assembleCombo(imported, imported.combos[0]).full,
      'ponytail, glowing tattoo',
    )
    assert.equal(
      imported.base.segments.hair.items.map((i) =>
        `${i.included ? '+' : '-'}${i.text}`
      ).join(' '),
      '+blue hair -star-shaped ahoge +blunt bangs +(long hair:1.2)',
    )
    assert.deepEqual(imported.combos, saved.combos)
    assert.equal(imported.profile, saved.profile)
    assert.equal(imported.base.segments.hair.facts[0].locked, true)

    const list = await (await req('/characters')).json()
    assert.equal(list.characters.length, 2)
    assert.equal((await (await req('/characters/search')).json()).length, 2)
  })
})

Deno.test('stale version is rejected with 409 and nothing is overwritten', async () => {
  await withApp('missing.sqlite', async (req) => {
    const c = await (await req('/characters', json({}))).json() as Character
    const content = {
      title: 'A',
      profile: '',
      customTags: [],
      base: c.base,
      combos: c.combos,
    }
    assert.equal(
      (await req(
        `/characters/item?path=${encodeURIComponent(c.path)}`,
        json({ expectedVersion: 1, content }, 'PUT'),
      )).status,
      200,
    )
    const r = await req(
      `/characters/item?path=${encodeURIComponent(c.path)}`,
      json({ expectedVersion: 1, content: { ...content, title: 'B' } }, 'PUT'),
    )
    assert.equal(r.status, 409)
    assert.equal((await r.json()).code, 'version_conflict')
    const now =
      await (await req(`/characters/item?path=${encodeURIComponent(c.path)}`))
        .json() as Character
    assert.equal(now.title, 'A')
  })
})

Deno.test('invalid content, foreign archives and unsafe paths are 422; missing files are 404', async () => {
  await withApp('missing.sqlite', async (req) => {
    const r1 = await req(
      '/characters/import',
      json({ archive: { format: 'other' } }),
    )
    assert.equal(r1.status, 422)
    const r2 = await req('/characters', json({ content: { title: 1 } }))
    assert.equal(r2.status, 422)
    for (
      const bad of [
        '../etc.json',
        'a/../b.json',
        'C:/x.json',
        'a\\b.json',
        'x.txt',
        '',
      ]
    ) {
      const r = await req(`/characters/item?path=${encodeURIComponent(bad)}`)
      assert.equal(r.status, 422, bad)
    }
    assert.equal((await req('/characters/item?path=nope.json')).status, 404)
    assert.equal((await req('/characters/item')).status, 422)
  })
})

Deno.test('missing catalog: status says unavailable, search is unverified (not "no match")', async () => {
  await withApp('does-not-exist.sqlite', async (req) => {
    const status = await (await req('/catalog/status')).json()
    assert.equal(status.available, false)
    assert.ok(!String(status.reason).includes(':\\'), 'no absolute path leaked')
    const s =
      await (await req('/catalog/search?q=blue%20hair&field=hair_color')).json()
    assert.deepEqual(s.verified, false)
    assert.deepEqual(s.items, [])
    // 手动编辑与导出不受影响
    const c = await (await req('/characters', json({}))).json() as Character
    assert.equal(
      (await req(
        `/characters/item/export/output?path=${
          encodeURIComponent(c.path)
        }&format=text`,
      )).status,
      200,
    )
  })
})

Deno.test({
  name: 'real catalog: field browsing and fact search with match evidence',
  ignore: !hasRealCatalog,
  fn: async () => {
    await withApp(
      REAL_CATALOG.pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      async (req) => {
        const status = await (await req('/catalog/status')).json()
        assert.equal(status.available, true)
        const bangs = await (await req(
          '/catalog/field-tags?field=bangs_shape&q=' +
            encodeURIComponent('齐'),
        )).json()
        assert.equal(bangs.verified, true)
        assert.equal(bangs.items[0].canonical, 'blunt bangs')
        const s = await (await req(
          '/catalog/search?field=bangs_shape&q=' +
            encodeURIComponent('齐刘海'),
        )).json()
        assert.equal(s.items[0].canonical, 'blunt bangs')
        assert.equal(s.items[0].match, 'label')
        assert.equal(s.items[0].inField, true)
        const exact = await (await req('/catalog/search?q=blue%20hair')).json()
        assert.equal(exact.items[0].canonical, 'blue hair')
        assert.equal(exact.items[0].match, 'canonical')
      },
    )
  },
})

Deno.test('only current-version project archives are accepted', async () => {
  await withApp('missing.sqlite', async (req) => {
    const c = await (await req('/characters', json({}))).json() as Character
    const archive = await (await req(
      `/characters/item/export/project?path=${encodeURIComponent(c.path)}`,
    ))
      .json()
    assert.equal(
      (await req('/characters/import', json({ archive }))).status,
      201,
    )
    const old = { ...archive, formatVersion: 1 }
    const r = await req('/characters/import', json({ archive: old }))
    assert.equal(r.status, 422)
    // 结构不全（缺少字段）不再自动补齐，直接拒绝
    const { customTags: _t, ...partial } = archive.character
    const r2 = await req(
      '/characters/import',
      json({ archive: { ...archive, character: partial } }),
    )
    assert.equal(r2.status, 422)
  })
})

Deno.test('segment search without a catalog is unverified, not "no match"', async () => {
  await withApp('does-not-exist.sqlite', async (req) => {
    const r = await (await req(
      '/catalog/segment-search?q=blue&paths=character.body.hair.color',
    )).json()
    assert.equal(r.verified, false)
    assert.deepEqual(r.items, [])
    assert.deepEqual(r.others, [])
  })
})

Deno.test({
  name:
    'real catalog: segment search lists in-section tags first and other categories separately',
  ignore: !hasRealCatalog,
  fn: async () => {
    await withApp(
      REAL_CATALOG.pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      async (req) => {
        const paths = 'character.body.hair'
        const r = await (await req(
          `/catalog/segment-search?q=${encodeURIComponent('blue')}&paths=${
            encodeURIComponent(paths)
          }`,
        )).json()
        assert.equal(r.verified, true)
        assert.ok(r.items.length > 0)
        for (const t of r.items) {
          assert.ok(t.categoryPath.startsWith(paths), t.categoryPath)
        }
        assert.ok(
          r.items.some((t: { canonical: string }) =>
            t.canonical === 'blue hair'
          ),
        )
        for (const h of r.others) {
          assert.equal(h.inField, false)
          assert.ok(
            !r.items.some((t: { canonical: string }) =>
              t.canonical === h.canonical
            ),
          )
        }
        const empty = await (await req('/catalog/segment-search?q=')).json()
        assert.deepEqual(empty.items, [])
      },
    )
  },
})

Deno.test('text match without a catalog is unverified, not "no match"', async () => {
  await withApp('does-not-exist.sqlite', async (req) => {
    const r = await (await req('/catalog/match', json({ text: '蓝发' })))
      .json()
    assert.equal(r.verified, false)
    assert.equal(r.candidates, undefined)
    assert.equal(
      (await req('/catalog/match', json({ text: 'x'.repeat(8001) }))).status,
      422,
    )
  })
})

Deno.test({
  name:
    'real catalog: text match finds loosely written tags and keeps category names as hints',
  ignore: !hasRealCatalog,
  fn: async () => {
    await withApp(
      REAL_CATALOG.pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      async (req) => {
        const r = await (await req(
          '/catalog/match',
          json({
            text: '一个蓝色长发的少女穿着水手服，在雨中撑着伞，表情有点害羞',
          }),
        )).json()
        assert.equal(r.verified, true)
        const tier = (canonical: string) =>
          r.candidates.find((t: { canonical: string }) =>
            t.canonical === canonical
          )?.tier ?? null
        assert.equal(tier('serafuku'), 'exact')
        assert.equal(tier('blue hair'), 'loose')
        assert.equal(tier('holding umbrella'), 'loose')
        // 「表情」是分类名：只作提示，不把整个分类的表情标签都列出来
        assert.equal(tier(':d'), null)
        assert.equal(tier('angry'), null)
        assert.ok(
          r.categoryHints.some((h: { path: string }) =>
            h.path === 'dynamics.expression'
          ),
        )
        const empty = await (await req('/catalog/match', json({ text: ' ' })))
          .json()
        assert.deepEqual(empty.candidates, [])
      },
    )
  },
})

Deno.test('category browsing without a catalog is unverified', async () => {
  await withApp('does-not-exist.sqlite', async (req) => {
    const r = await (await req('/catalog/category?path=character')).json()
    assert.equal(r.verified, false)
  })
})

Deno.test({
  name:
    'real catalog: category browsing lists roots, children, ancestors and paged tags',
  ignore: !hasRealCatalog,
  fn: async () => {
    await withApp(
      REAL_CATALOG.pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      async (req) => {
        const roots = await (await req('/catalog/category')).json()
        assert.equal(roots.verified, true)
        assert.equal(roots.category, null)
        assert.deepEqual(roots.tags, [])
        const rootPaths = roots.children.map((c: { path: string }) => c.path)
        assert.ok(rootPaths.includes('character'))
        // 没开放受限内容时，没有标签的 explicit 不列出
        assert.ok(!rootPaths.includes('explicit'))

        const hair = await (await req(
          '/catalog/category?path=character.body.hair&limit=5',
        )).json()
        assert.equal(hair.category.labelZh, '头发')
        assert.deepEqual(
          hair.ancestors.map((a: { path: string }) => a.path),
          ['character', 'character.body'],
        )
        assert.ok(
          hair.children.some((c: { path: string }) =>
            c.path === 'character.body.hair.color'
          ),
        )
        assert.equal(hair.tags.length, 5)
        assert.equal(hair.total, hair.category.tagCount)
        const page2 = await (await req(
          '/catalog/category?path=character.body.hair&limit=5&offset=5',
        )).json()
        assert.equal(page2.offset, 5)
        assert.notEqual(page2.tags[0].canonical, hair.tags[0].canonical)

        const blue = await (await req(
          `/catalog/category?path=character.body.hair&q=${
            encodeURIComponent('蓝')
          }`,
        )).json()
        assert.equal(blue.tags[0].canonical, 'blue hair')
        assert.equal(blue.total, blue.tags.length)

        const missing = await req('/catalog/category?path=no.such.category')
        assert.equal(missing.status, 404)
        assert.equal((await missing.json()).code, 'not_found')
      },
    )
  },
})

Deno.test({
  name:
    'real catalog: tag detail has the full category trail and per-source records',
  ignore: !hasRealCatalog,
  fn: async () => {
    await withApp(
      REAL_CATALOG.pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      async (req) => {
        const r = await (await req('/catalog/tag?canonical=blue_hair')).json()
        assert.equal(r.verified, true)
        assert.equal(r.tag.canonical, 'blue hair')
        assert.deepEqual(
          r.tag.categoryTrail.map((c: { labelZh: string }) => c.labelZh),
          ['角色', '身体', '头发', '颜色'],
        )
        assert.ok(r.tag.categoryOwnCount > 0)
        // 第一条总是 tags-tree；导入过 CSV 的词库后面还有 CSV 的记录
        assert.deepEqual(r.tag.sourceRecords[0], {
          source: 'tags-tree',
          key: 'blue_hair',
        })
        const missing = await req('/catalog/tag?canonical=no%20such%20tag')
        assert.equal(missing.status, 404)
      },
    )
  },
})
