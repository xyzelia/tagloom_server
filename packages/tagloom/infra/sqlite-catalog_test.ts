// v4 词库读取：用 catalog-import 生成一个很小的词库，再模拟 CSV 写入的列（别名、zh、count），
// 不依赖 data/ 里的真实词库。
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  FREQUENCY_FILE,
  MULTILINGUAL_FILE,
  readTagsTree,
  TREE_FILE,
} from '../catalog-import/tags-tree.ts'
import { writeTagsTreeCatalog } from '../catalog-import/write.ts'
import { openSqliteCatalog } from './sqlite-catalog.ts'

const TREE = `_meta:
  version: '3.9'
character:
  body:
    hair:
      color:
      - blue_hair
      - light_blue_hair
      - blonde_hair
dynamics:
  expression:
  - embarrassed
  - blush
explicit:
  nudity:
  - nude
`

const MULTILINGUAL = `category.character:
  en: character
  ja: キャラクター
  zh-CN: 角色
category.character.body:
  en: body
  ja: 体
  zh-CN: 身体
category.character.body.hair:
  en: hair
  ja: 髪
  zh-CN: 头发
category.character.body.hair.color:
  en: color
  ja: 色
  zh-CN: 颜色
category.dynamics:
  en: dynamics
  ja: 動き
  zh-CN: 动态
category.dynamics.expression:
  en: expression
  ja: 表情
  zh-CN: 表情
category.explicit:
  en: explicit
  ja: 露骨
  zh-CN: 露骨
category.explicit.nudity:
  en: nudity
  ja: 裸
  zh-CN: 裸体
tag.blue_hair:
  en: blue hair
  ja: 青髪
  zh-CN: 蓝发
tag.light_blue_hair:
  en: light blue hair
  ja: 水色髪
  zh-CN: 浅蓝色头发
tag.blonde_hair:
  en: blonde hair
  ja: 金髪
  zh-CN: ''
tag.embarrassed:
  en: embarrassed
  ja: 羞恥
  zh-CN: 害羞
tag.blush:
  en: blush
  ja: 赤面
  zh-CN: 害羞
tag.nude:
  en: nude
  ja: 裸
  zh-CN: 裸体
`

const FREQUENCY = `tag,count
blue_hair,1000
light_blue_hair,300
blonde_hair,900
embarrassed,200
blush,800
nude,100
`

async function withCatalog(
  fn: (path: string) => void | Promise<void>,
) {
  const repo = await Deno.makeTempDir()
  const dir = await Deno.makeTempDir()
  try {
    await Deno.mkdir(`${repo}/data/source`, { recursive: true })
    await Deno.writeTextFile(`${repo}/${TREE_FILE}`, TREE)
    await Deno.writeTextFile(`${repo}/${MULTILINGUAL_FILE}`, MULTILINGUAL)
    await Deno.writeTextFile(`${repo}/${FREQUENCY_FILE}`, FREQUENCY)
    const { data, log } = await readTagsTree(repo, {
      git: false,
      now: new Date('2026-10-26T00:00:00.000Z'),
    })
    const path = `${dir}/catalog.sqlite`
    await writeTagsTreeCatalog(path, data, log)
    // 模拟 CSV 导入（seq 2）：别名、中文名、频次、一个没有分类的新标签
    const db = new DatabaseSync(path)
    db.exec(`
      INSERT INTO tag_alias (name, term, source) VALUES
        ('embarrassed', 'embarrassing', 2), ('blonde hair', 'yellow_hair', 2);
      UPDATE tag SET zh = '金发', count = 5000 WHERE name = 'blonde hair';
      UPDATE tag SET notes = '脸颊泛红的样子' WHERE name = 'blush';
      UPDATE tag SET notes = '头发是浅蓝色，Light Blue' WHERE name = 'light blue hair';
      INSERT INTO tag (name, source_key, zh, count, type) VALUES ('highres', 'highres', '高分辨率', 9000, 5);
      INSERT INTO tag_source (name, source, source_key) VALUES ('highres', 2, 'highres');
      INSERT INTO import_log (seq, path, kind, name, imported_at, sha256, bytes, rows)
        VALUES (2, 'meta.csv', 'csv', 'ame-la', '2026-10-26T00:00:01.000Z', 'x', 1, 1);
    `)
    db.close()
    await fn(path)
  } finally {
    await Deno.remove(repo, { recursive: true })
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test('v4 catalog: status, search, lookup and CSV columns', async () => {
  await withCatalog((path) => {
    const cat = openSqliteCatalog({ path })
    const status = cat.status()
    assert.ok(status.available)
    assert.equal(status.version, 'v4@2026-10-26T00:00:00.000Z')
    // 受限标签默认不算、不显示
    assert.equal(status.tagCount, 6)
    assert.deepEqual(status.sources.map((s) => s.name), ['tags-tree', 'ame-la'])

    const exact = cat.search('blue hair', 5, [])
    assert.equal(exact[0].canonical, 'blue hair')
    assert.equal(exact[0].match, 'canonical')
    const label = cat.search('蓝发', 5, [])
    assert.equal(label[0].canonical, 'blue hair')
    assert.equal(label[0].match, 'label')
    // 字段对应的分类优先
    const inField = cat.search('hair', 5, ['character.body.hair'])
    assert.ok(inField.length >= 3)
    assert.ok(inField.slice(0, 3).every((h) => h.inField))

    assert.equal(cat.lookup('Blue_Hair').status, 'exact')
    assert.equal(cat.lookup('青髪').status, 'label')
    const alias = cat.lookup('embarrassing')
    assert.equal(alias.status, 'alias')
    assert.equal(alias.tags[0].canonical, 'embarrassed')
    // 两个标签的中文名都是「害羞」
    const amb = cat.lookup('害羞')
    assert.equal(amb.status, 'ambiguous')
    assert.deepEqual(amb.tags.map((t) => t.canonical), ['blush', 'embarrassed'])
    assert.equal(cat.lookup('zzqx').status, 'none')
    // 受限标签当作不存在
    assert.equal(cat.lookup('nude').status, 'none')
    assert.equal(cat.tagDetail('nude'), null)

    // tags-tree 没有中文名时用 CSV 的 zh；频次优先用 CSV 的 count
    const blonde = cat.tagDetail('blonde_hair')!
    assert.equal(blonde.labelZh, '金发')
    assert.equal(blonde.postCount, 5000)
    assert.deepEqual(blonde.aliases, ['yellow_hair'])
    assert.equal(cat.lookup('yellow hair').status, 'alias')

    // 只来自 CSV、没有分类的标签：能搜到、能核对，没有分类层级
    assert.equal(cat.lookup('highres').status, 'exact')
    assert.equal(cat.search('高分辨率', 5, [])[0].canonical, 'highres')
    const highres = cat.tagDetail('highres')!
    assert.equal(highres.categoryPath, '')
    assert.deepEqual(highres.categoryTrail, [])
    assert.deepEqual(highres.sourceRecords, [
      { source: 'ame-la', key: 'highres' },
    ])
  })
})

Deno.test('v4 catalog: notes are searched last and only by search', async () => {
  await withCatalog((path) => {
    const cat = openSqliteCatalog({ path })
    const hits = cat.search('泛红', 5, [])
    assert.equal(hits.length, 1)
    assert.equal(hits[0].canonical, 'blush')
    assert.equal(hits[0].match, 'partial')
    assert.equal(hits[0].evidence, '泛红')
    assert.equal(hits[0].byNote, true)
    assert.equal(hits[0].notes, '脸颊泛红的样子')
    // 每个词都要出现在说明里；大小写、全半角按规范化比较
    assert.deepEqual(cat.search('脸颊 样子', 5, []).map((h) => h.canonical), [
      'blush',
    ])
    // 「头发」只命中分类名，说明里没有同时含两个词的
    assert.ok(cat.search('脸颊 头发', 5, []).every((h) => !h.byNote))
    assert.equal(
      cat.search('ＬＩＧＨＴ', 5, [])[0].canonical,
      'light blue hair',
    )
    // 名称也命中时按名称算，排在只靠说明命中的前面
    const hair = cat.search('头发', 5, [])
    assert.ok(hair.every((h) => !h.byNote || h.canonical !== 'light blue hair'))
    // 核对和文本匹配不用说明
    assert.equal(cat.lookup('泛红').status, 'none')
    assert.ok(
      !cat.matchText('脸颊泛红', 20).candidates.some((c) =>
        c.canonical === 'blush'
      ),
    )
  })
})

Deno.test('v4 catalog: category browsing and field lists', async () => {
  await withCatalog((path) => {
    const cat = openSqliteCatalog({ path })
    const roots = cat.category('', '', 10, 0)!
    // explicit 没有可显示的标签，不列出
    assert.deepEqual(roots.children.map((c) => c.path), [
      'character',
      'dynamics',
    ])
    const hair = cat.category('character.body.hair', '', 2, 0)!
    assert.equal(hair.category?.labelZh, '头发')
    assert.equal(hair.category?.tagCount, 3)
    assert.deepEqual(hair.ancestors.map((a) => a.path), [
      'character',
      'character.body',
    ])
    assert.deepEqual(hair.children.map((c) => c.path), [
      'character.body.hair.color',
    ])
    // 按频次（blonde hair 用 CSV 的 5000）
    assert.deepEqual(hair.tags.map((t) => t.canonical), [
      'blonde hair',
      'blue hair',
    ])
    assert.equal(hair.total, 3)
    const blue = cat.category('character.body.hair', '蓝', 10, 0)!
    assert.deepEqual(blue.tags.map((t) => t.canonical), [
      'blue hair',
      'light blue hair',
    ])
    assert.equal(cat.category('no.such', '', 10, 0), null)
    assert.deepEqual(
      cat.listInCategories(['character.body.hair'], 'yellow', 10).map((t) =>
        t.canonical
      ),
      ['blonde hair'],
    )
    const detail = cat.tagDetail('blue hair')!
    assert.deepEqual(detail.categoryTrail.map((c) => c.labelZh), [
      '角色',
      '身体',
      '头发',
      '颜色',
    ])
    assert.equal(detail.categoryOwnCount, 3)
  })
})

Deno.test('v4 catalog: restricted tags are shown when allowed', async () => {
  await withCatalog((path) => {
    const cat = openSqliteCatalog({ path, allowRestricted: true })
    assert.equal(cat.lookup('nude').status, 'exact')
    assert.ok(
      cat.category('', '', 10, 0)!.children.some((c) => c.path === 'explicit'),
    )
  })
})

Deno.test('v4 catalog: text match uses names and category hints', async () => {
  await withCatalog((path) => {
    const cat = openSqliteCatalog({ path })
    const r = cat.matchText('蓝发的少女，表情有点害羞', 20)
    const tier = (c: string) =>
      r.candidates.find((t) => t.canonical === c)?.tier ?? null
    assert.equal(tier('blue hair'), 'exact')
    assert.equal(tier('embarrassed'), 'exact')
    assert.ok(r.categoryHints.some((h) => h.path === 'dynamics.expression'))
  })
})

Deno.test('v4 catalog: older catalog formats are refused', async () => {
  const dir = await Deno.makeTempDir()
  try {
    const path = `${dir}/old.sqlite`
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version = 3; CREATE TABLE tags (id INTEGER)')
    db.close()
    assert.throws(() => openSqliteCatalog({ path }), /tagloom-catalog tree/)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
