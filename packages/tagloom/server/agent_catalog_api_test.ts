// agent 词库批量接口：每条各自分页（没超过上限只有 items；分了页每页带 total，还有下一页带 nextOffset）、
// 单条出错不影响其他条、翻页时词库版本不一致报 catalog_changed。真实词库测试只在词库存在时运行。
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { closeTagloomRuntime, tagloomPlugin } from './mod.ts'
import { agentPage } from '../core/mod.ts'

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
const realPath = REAL_CATALOG.pathname.replace(/^\/([A-Za-z]:)/, '$1')

type Post = (path: string, body: unknown) => Promise<Response>

async function withApp(catalogPath: string, fn: (post: Post) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: 'tagloom_agent_catalog_' })
  closeTagloomRuntime()
  const plugin = tagloomPlugin({ dataDir: dir, catalogPath })
  const app = new Hono().basePath('/api').route(`/${plugin.name}`, plugin.api)
  const post: Post = (path, body) =>
    Promise.resolve(app.request(`/api/tagloom/agent/catalog${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
  try {
    await fn(post)
  } finally {
    closeTagloomRuntime()
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test('agentPage: only paged results carry total / nextOffset', () => {
  assert.deepEqual(agentPage([1, 2], 2, 0, 100), { items: [1, 2] })
  assert.deepEqual(agentPage([1, 2], 5, 0, 2), {
    items: [1, 2],
    total: 5,
    nextOffset: 2,
  })
  // 最后一页：带 total，不带 nextOffset
  assert.deepEqual(agentPage([5], 5, 4, 2), { items: [5], total: 5 })
  // 翻过头
  assert.deepEqual(agentPage([], 5, 10, 2), { items: [], total: 5 })
})

Deno.test('agent catalog without a catalog is unverified; invalid bodies are 422', async () => {
  await withApp('missing.sqlite', async (post) => {
    const r = await (await post('/lookup', { tags: ['blue hair'] })).json()
    assert.equal(r.verified, false)
    assert.equal(r.results, undefined)
    assert.equal((await post('/lookup', { tags: [] })).status, 422)
    const tooMany = Array.from({ length: 21 }, () => ({ q: 'x' }))
    assert.equal((await post('/search', { queries: tooMany })).status, 422)
    assert.equal(
      (await post('/match', { queries: [{ text: 'x', tiers: ['bogus'] }] }))
        .status,
      422,
    )
  })
})

Deno.test({
  name: 'real catalog: lookup statuses',
  ignore: !hasRealCatalog,
  fn: async () => {
    await withApp(realPath, async (post) => {
      const r = await (await post('/lookup', {
        // 别名（alias）来自 CSV 导入；只导入 tags-tree 的词库没有别名
        tags: ['Blue_Hair', '蓝发', '水手服', 'zzqx nothing'],
      })).json()
      assert.equal(r.verified, true)
      const by = Object.fromEntries(
        r.results.map((x: { input: string }) => [x.input, x]),
      )
      assert.equal(by['Blue_Hair'].status, 'exact')
      assert.equal(by['Blue_Hair'].tag.canonical, 'blue hair')
      assert.equal(by['蓝发'].status, 'label')
      assert.equal(by['蓝发'].tag.canonical, 'blue hair')
      // 水手服 对应 serafuku、serasuku 等多个标签
      assert.equal(by['水手服'].status, 'ambiguous')
      assert.ok(by['水手服'].tags.length > 1)
      assert.equal(by['zzqx nothing'].status, 'none')
      assert.ok(Array.isArray(by['zzqx nothing'].suggestions))
      // 精简字段
      assert.deepEqual(Object.keys(by['Blue_Hair'].tag).sort(), [
        'canonical',
        'categoryPath',
        'labelZh',
        'postCount',
      ])
    })
  },
})

Deno.test({
  name:
    'real catalog: categories page per query, errors per item, version check',
  ignore: !hasRealCatalog,
  fn: async () => {
    await withApp(realPath, async (post) => {
      const first = await (await post('/categories', {
        queries: [
          { path: 'character.body.hair' },
          { path: 'dynamics.expression.emotion.shy' },
          { path: 'no.such.category' },
        ],
        // 超过 100 按 100 处理
        limit: 500,
      })).json()
      const [hair, shy, missing] = first.results
      assert.deepEqual(hair.input, { path: 'character.body.hair' })
      assert.equal(hair.items.length, 100)
      assert.ok(hair.total > 100)
      assert.equal(hair.nextOffset, 100)
      assert.equal(hair.category.labelZh, '头发')
      assert.ok(hair.children.length > 0)
      // 没分页：只有 items（和第一页的分类信息）
      assert.ok(shy.items.length > 0 && shy.items.length <= 100)
      assert.equal(shy.total, undefined)
      assert.equal(shy.nextOffset, undefined)
      assert.equal(missing.error.code, 'not_found')

      const next = await (await post('/categories', {
        catalogVersion: first.catalogVersion,
        queries: [{ path: 'character.body.hair', offset: hair.nextOffset }],
      })).json()
      const page2 = next.results[0]
      assert.equal(page2.total, hair.total)
      assert.equal(page2.category, undefined)
      assert.notEqual(page2.items[0].canonical, hair.items[0].canonical)

      // 最后一页带 total、不带 nextOffset
      const lastAt = Math.floor((hair.total - 1) / 100) * 100
      const last = (await (await post('/categories', {
        queries: [{ path: 'character.body.hair', offset: lastAt }],
      })).json()).results[0]
      assert.equal(last.total, hair.total)
      assert.equal(last.nextOffset, undefined)
      assert.equal(last.items.length, hair.total - lastAt)

      const stale = await (await post('/categories', {
        catalogVersion: 'v0@old',
        queries: [
          { path: 'character.body.hair', offset: 100 },
          { path: 'character.body.hair' },
        ],
      })).json()
      assert.equal(stale.results[0].error.code, 'catalog_changed')
      // 第一页不受版本影响
      assert.equal(stale.results[1].items.length, 100)

      const roots = (await (await post('/categories', { queries: [{}] }))
        .json()).results[0]
      assert.equal(roots.category, null)
      assert.deepEqual(roots.items, [])
      assert.ok(
        roots.children.some((c: { path: string }) => c.path === 'character'),
      )
    })
  },
})

Deno.test({
  name: 'real catalog: match / search / tags in batch',
  ignore: !hasRealCatalog,
  fn: async () => {
    await withApp(realPath, async (post) => {
      const m = await (await post('/match', {
        queries: [
          {
            text: '一个蓝色长发的少女穿着水手服，在雨中撑着伞，表情有点害羞',
            tiers: ['exact', 'loose'],
          },
          { text: 'a girl holding an umbrella in the rain' },
        ],
        limit: 20,
      })).json()
      const [zh, en] = m.results
      assert.ok(
        zh.items.every((t: { tier: string }) =>
          t.tier === 'exact' || t.tier === 'loose'
        ),
      )
      assert.ok(
        zh.items.some((t: { canonical: string }) =>
          t.canonical === 'holding umbrella'
        ),
      )
      assert.ok(zh.categoryHints.length > 0)
      assert.ok(en.total > 20)
      assert.equal(en.nextOffset, 20)
      const enNext = (await (await post('/match', {
        queries: [{ text: en.input.text, offset: 20 }],
        limit: 20,
      })).json()).results[0]
      assert.equal(enNext.categoryHints, undefined)
      assert.equal(enNext.total, en.total)

      const s = await (await post('/search', {
        queries: [
          { q: '齐刘海', field: 'bangs_shape' },
          { q: 'blue', field: 'no_such_field' },
        ],
      })).json()
      assert.equal(s.results[0].items[0].canonical, 'blunt bangs')
      assert.equal(s.results[0].items[0].inField, true)
      assert.equal(s.results[1].error.code, 'invalid_request')

      const t = await (await post('/tags', {
        canonicals: ['blue hair', 'no such tag'],
      })).json()
      assert.equal(t.results[0].tag.categoryTrail.length, 4)
      assert.equal(t.results[1].error.code, 'not_found')
    })
  },
})
