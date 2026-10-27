import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { assertRelativePath, sanitizeRepository } from './privacy.ts'
import {
  FREQUENCY_FILE,
  missingPaths,
  MULTILINGUAL_FILE,
  parseTagsTree,
  readTagsTree,
  TREE_FILE,
} from './tags-tree.ts'
import { writeTagsTreeCatalog } from './write.ts'

const TREE = `_meta:
  version: '3.9'
character:
  body:
    hair:
      color:
      - blue_hair
      - blonde_hair
  count:
    _tags:
    - 1girl
explicit:
  nudity:
  - nude
text:
  symbol:
  - 'true'
  - 100
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
category.character.count:
  en: count
  ja: 人数
  zh-CN: 人数
category.explicit:
  en: explicit
  ja: 露骨
  zh-CN: 露骨
category.explicit.nudity:
  en: nudity
  ja: 裸
  zh-CN: 裸体
category.text:
  en: text
  ja: テキスト
  zh-CN: 文本
tag.blue_hair:
  en: blue hair
  ja: 青髪
  zh-CN: 蓝发
tag.1girl:
  en: 1 girl
  ja: 1人の女の子
  zh-CN: 一个女孩
tag.nude:
  en: nude
  ja: 裸
  zh-CN: 裸体
tag.true:
  en: 'true'
  ja: 真
  zh-CN: 真
tag.100:
  en: '100'
  ja: 百
  zh-CN: 一百
`

const FREQUENCY = `tag,count
blue_hair,1088813
blonde_hair,900000
1girl,8000000
nude,500000
true,10
`

Deno.test('tags-tree: categories, tags, labels, frequency and restricted root', () => {
  const d = parseTagsTree({
    tree: TREE,
    multilingual: MULTILINGUAL,
    frequency: FREQUENCY,
  })
  assert.equal(d.version, '3.9')
  assert.deepEqual(d.categories.map((c) => c.path), [
    'character',
    'character.body',
    'character.body.hair',
    'character.body.hair.color',
    'character.count',
    'explicit',
    'explicit.nudity',
    'text',
    'text.symbol',
  ])
  const by = new Map(d.tags.map((t) => [t.name, t]))
  assert.deepEqual(by.get('blue hair'), {
    name: 'blue hair',
    sourceKey: 'blue_hair',
    categoryPath: 'character.body.hair.color',
    labelEn: 'blue hair',
    labelJa: '青髪',
    labelZh: '蓝发',
    postCount: 1088813,
    restricted: false,
  })
  // _tags 挂在所在这一层
  assert.equal(by.get('1girl')?.categoryPath, 'character.count')
  assert.equal(by.get('nude')?.restricted, true)
  // failsafe：true / 100 仍是字符串标签
  assert.equal(by.get('true')?.sourceKey, 'true')
  assert.equal(by.get('100')?.labelZh, '一百')
  // 缺名称、缺频次、缺分类名称都只提醒
  assert.equal(by.get('blonde hair')?.labelZh, '')
  assert.equal(by.get('100')?.postCount, 0)
  const symbol = d.categories.find((c) => c.path === 'text.symbol')!
  assert.equal(symbol.labelEn, 'symbol')
  assert.ok(d.warnings.some((w) => w.includes('blonde_hair')))
  assert.ok(d.warnings.some((w) => w.includes('频次记为 0')))
  assert.ok(d.warnings.some((w) => w.includes('text.symbol')))
  assert.equal(d.frequencyRows, 5)
})

Deno.test('tags-tree: duplicate tags keep the first, dotted names are rejected', () => {
  const d = parseTagsTree({
    tree: 'a:\n  b:\n  - x_y\n  c:\n  - x y\n',
    multilingual: '{}',
    frequency: 'tag,count\n',
  })
  assert.equal(d.tags.length, 1)
  assert.equal(d.tags[0].categoryPath, 'a.b')
  assert.ok(d.warnings.some((w) => w.includes('重复')))
  assert.throws(
    () =>
      parseTagsTree({
        tree: 'a:\n  b.c:\n  - x\n',
        multilingual: '{}',
        frequency: 'tag,count\n',
      }),
    /不能为空或含「.」/,
  )
})

Deno.test('tags-tree: missing referenced paths are reported', () => {
  const d = parseTagsTree({
    tree: TREE,
    multilingual: MULTILINGUAL,
    frequency: FREQUENCY,
  })
  assert.deepEqual(
    missingPaths(d, ['character.body.hair.color', 'apparel.top']),
    ['apparel.top'],
  )
})

Deno.test('privacy: only relative paths, repository without credentials or local paths', () => {
  assert.equal(assertRelativePath('data/source/x.yaml'), 'data/source/x.yaml')
  assert.equal(assertRelativePath('general.csv'), 'general.csv')
  for (
    const bad of [
      '/etc/x',
      'C:\\Users\\someone\\x.csv',
      '\\x',
      '../x',
      'a/../b',
    ]
  ) {
    assert.throws(() => assertRelativePath(bad), bad)
  }
  assert.equal(
    sanitizeRepository(
      'https://user:ghp_token@github.com/Jannchie/danbooru-tags-tree.git',
    ),
    'https://github.com/Jannchie/danbooru-tags-tree.git',
  )
  assert.equal(
    sanitizeRepository('git@github.com:Jannchie/danbooru-tags-tree.git'),
    'git@github.com:Jannchie/danbooru-tags-tree.git',
  )
  assert.equal(sanitizeRepository('C:\\Users\\someone\\repo'), '')
  assert.equal(sanitizeRepository('/home/someone/repo'), '')
  assert.equal(sanitizeRepository('file:///home/someone/repo'), '')
  assert.equal(sanitizeRepository('../repo'), '')
})

Deno.test('tags-tree: writes a v4 catalog with relative import log rows', async () => {
  const repo = await Deno.makeTempDir()
  const outDir = await Deno.makeTempDir()
  try {
    await Deno.mkdir(`${repo}/data/source`, { recursive: true })
    await Deno.writeTextFile(`${repo}/${TREE_FILE}`, TREE)
    await Deno.writeTextFile(`${repo}/${MULTILINGUAL_FILE}`, MULTILINGUAL)
    await Deno.writeTextFile(`${repo}/${FREQUENCY_FILE}`, FREQUENCY)
    await Deno.writeTextFile(`${repo}/LICENSE`, 'MIT License\n\nCopyright')
    const now = new Date('2026-10-26T00:00:00.000Z')
    const { data, log } = await readTagsTree(repo, { git: false, now })
    const out = `${outDir}/catalog.sqlite`
    assert.deepEqual(await writeTagsTreeCatalog(out, data, log), {
      replaced: false,
    })
    // 再生成一次：替换原文件
    assert.deepEqual(await writeTagsTreeCatalog(out, data, log), {
      replaced: true,
    })

    const db = new DatabaseSync(out, { readOnly: true })
    try {
      const one = (sql: string) =>
        db.prepare(sql).get() as Record<string, unknown>
      assert.equal(one('PRAGMA user_version').user_version, 4)
      assert.deepEqual(
        db.prepare('SELECT key, value FROM meta ORDER BY key').all().map((
          r,
        ) => ({ ...r })),
        [
          { key: 'alias_count', value: '0' },
          { key: 'generated_at', value: '2026-10-26T00:00:00.000Z' },
          { key: 'schema_version', value: '4' },
          { key: 'tag_count', value: '6' },
        ],
      )
      assert.deepEqual(
        { ...one(`SELECT * FROM tag WHERE name = 'nude'`) },
        {
          name: 'nude',
          source_key: 'nude',
          category_path: 'explicit.nudity',
          label_en: 'nude',
          label_ja: '裸',
          label_zh: '裸体',
          post_count: 500000,
          restricted: 1,
          type: null,
          zh: '',
          count: null,
          notes: '',
        },
      )
      assert.equal(
        one('SELECT count(*) AS n FROM tag_source WHERE source = 1').n,
        6,
      )
      const rows = db.prepare('SELECT * FROM import_log ORDER BY path').all()
      assert.deepEqual(rows.map((r) => r.path), [
        MULTILINGUAL_FILE,
        TREE_FILE,
        FREQUENCY_FILE,
      ])
      for (const r of rows) {
        assert.equal(r.seq, 1)
        assert.equal(r.kind, 'tags-tree')
        assert.equal(r.license, 'MIT')
        assert.equal(r.data_version, '3.9')
        assert.equal(r.repository, '')
        assert.match(String(r.sha256), /^[0-9a-f]{64}$/)
      }
      assert.equal(rows[2].rows, 5)
      assert.equal(rows[1].rows, null)
    } finally {
      db.close()
    }
  } finally {
    await Deno.remove(repo, { recursive: true })
    await Deno.remove(outDir, { recursive: true })
  }
})

Deno.test('tags-tree: missing source file is an error', async () => {
  const repo = await Deno.makeTempDir()
  try {
    await assert.rejects(readTagsTree(repo, { git: false }), /缺少/)
  } finally {
    await Deno.remove(repo, { recursive: true })
  }
})
