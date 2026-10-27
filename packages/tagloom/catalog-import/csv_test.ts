import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { importCsvFiles, parseCatalogCsv } from './csv.ts'
import {
  FREQUENCY_FILE,
  MULTILINGUAL_FILE,
  readTagsTree,
  TREE_FILE,
} from './tags-tree.ts'
import { writeTagsTreeCatalog } from './write.ts'

const SOURCE = {
  name: 'ame-la',
  repository: 'https://huggingface.co/datasets/ame-la/danbooru-tags-data-zh',
  revision: 'f7ef17a',
  dirty: false,
  license: 'MIT',
  dataVersion: '2026-08',
}

Deno.test('csv: parse columns, aliases and invalid cells', () => {
  const r = parseCatalogCsv(
    [
      'tag,category,aliases,zh,count,notes,extra',
      'Blue_Hair,0,blue|蓝毛|,蓝色头发,1088813,头发是蓝色,x',
      'highres,5,high_res|hires,高分辨率,8033637,"宽至少1600像素,或高至少1200像素",',
      ',0,,,,,',
      'weird,9,,,-1,,',
      '',
    ].join('\n'),
    'general.csv',
  )
  // 末尾的空行不算
  assert.equal(r.dataRows, 4)
  assert.deepEqual(r.rows[0], {
    name: 'blue hair',
    sourceKey: 'Blue_Hair',
    type: 0,
    zh: '蓝色头发',
    count: 1088813,
    notes: '头发是蓝色',
    aliases: ['blue', '蓝毛'],
  })
  assert.equal(r.rows[1].notes, '宽至少1600像素,或高至少1200像素')
  assert.deepEqual(r.rows[2], {
    name: 'weird',
    sourceKey: 'weird',
    type: null,
    zh: '',
    count: null,
    notes: '',
    aliases: [],
  })
  assert.equal(r.rows.length, 3)
  const w = r.warnings.join('\n')
  assert.match(w, /忽略不认识的列 extra/)
  assert.match(w, /tag 为空/)
  assert.match(w, /category 不是/)
  assert.match(w, /count 不是非负整数/)
  // 只有 tag 列也可以
  assert.equal(parseCatalogCsv('tag\nfoo\n', 'a.csv').rows[0].name, 'foo')
  assert.throws(() => parseCatalogCsv('name,zh\nx,y\n', 'a.csv'), /没有 tag 列/)
})

const TREE = `_meta:
  version: '3.9'
character:
  body:
    hair:
      color:
      - blue_hair
      - blonde_hair
`
const MULTILINGUAL = `category.character:
  zh-CN: 角色
category.character.body:
  zh-CN: 身体
category.character.body.hair:
  zh-CN: 头发
category.character.body.hair.color:
  zh-CN: 颜色
tag.blue_hair:
  en: blue hair
  ja: 青髪
  zh-CN: 蓝发
tag.blonde_hair:
  en: blonde hair
  ja: 金髪
`
const FREQUENCY = 'tag,count\nblue_hair,1000\nblonde_hair,900\n'

async function withTreeCatalog(
  fn: (db: string, dir: string) => Promise<void>,
) {
  const dir = await Deno.makeTempDir()
  try {
    const repo = `${dir}/repo`
    await Deno.mkdir(`${repo}/data/source`, { recursive: true })
    await Deno.writeTextFile(`${repo}/${TREE_FILE}`, TREE)
    await Deno.writeTextFile(`${repo}/${MULTILINGUAL_FILE}`, MULTILINGUAL)
    await Deno.writeTextFile(`${repo}/${FREQUENCY_FILE}`, FREQUENCY)
    const { data, log } = await readTagsTree(repo, {
      git: false,
      now: new Date('2026-10-26T00:00:00.000Z'),
    })
    await writeTagsTreeCatalog(`${dir}/catalog.sqlite`, data, log)
    await fn(`${dir}/catalog.sqlite`, dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test('csv: import fills CSV columns only, creates new tags, merges aliases', async () => {
  await withTreeCatalog(async (db, dir) => {
    await Deno.mkdir(`${dir}/a`)
    await Deno.writeTextFile(
      `${dir}/a/general.csv`,
      String.fromCharCode(0xfeff) + 'tag,category,aliases,zh,count,notes\n' +
        'blue_hair,0,blue_hair|蓝毛|Blue Hair|蓝毛,蓝色头发,1088813,头发是蓝色\n' +
        'blonde_hair,0,yellow_hair,金发,5000,\n',
    )
    await Deno.writeTextFile(
      `${dir}/a/meta.csv`,
      'tag,category,aliases,zh,count,notes\nhighres,5,hires,高分辨率,8033637,高分辨率的图\n',
    )
    const now = new Date('2026-10-27T00:00:00.000Z')
    const r = await importCsvFiles(
      db,
      [`${dir}/a/general.csv`, `${dir}/a/meta.csv`],
      SOURCE,
      { now },
    )
    assert.equal(r.seq, 2)
    assert.equal(r.created, 1)
    assert.equal(r.updated, 2)
    // blue_hair 本身、重复的「蓝毛」跳过
    assert.equal(r.aliasesAdded, 3)
    assert.equal(r.tagCount, 3)
    assert.equal(r.aliasCount, 3)

    const read = () => new DatabaseSync(db, { readOnly: true })
    let d = read()
    const tag = (name: string) => ({
      ...d.prepare('SELECT * FROM tag WHERE name = ?').get(name),
    })
    // tags-tree 列不变，CSV 列写入
    assert.deepEqual(tag('blue hair'), {
      name: 'blue hair',
      source_key: 'blue_hair',
      category_path: 'character.body.hair.color',
      label_en: 'blue hair',
      label_ja: '青髪',
      label_zh: '蓝发',
      post_count: 1000,
      restricted: 0,
      type: 0,
      zh: '蓝色头发',
      count: 1088813,
      notes: '头发是蓝色',
    })
    assert.deepEqual(tag('highres'), {
      name: 'highres',
      source_key: 'highres',
      category_path: null,
      label_en: '',
      label_ja: '',
      label_zh: '',
      post_count: 0,
      restricted: 0,
      type: 5,
      zh: '高分辨率',
      count: 8033637,
      notes: '高分辨率的图',
    })
    assert.deepEqual(
      d.prepare('SELECT name, term, source FROM tag_alias ORDER BY name, term')
        .all().map((x) => ({ ...x })),
      [
        { name: 'blonde hair', term: 'yellow_hair', source: 2 },
        { name: 'blue hair', term: '蓝毛', source: 2 },
        { name: 'highres', term: 'hires', source: 2 },
      ],
    )
    assert.deepEqual(
      d.prepare(
        'SELECT seq, path, kind, name, license, data_version, rows FROM import_log WHERE seq = 2 ORDER BY path',
      ).all().map((x) => ({ ...x })),
      [
        {
          seq: 2,
          path: 'general.csv',
          kind: 'csv',
          name: 'ame-la',
          license: 'MIT',
          data_version: '2026-08',
          rows: 2,
        },
        {
          seq: 2,
          path: 'meta.csv',
          kind: 'csv',
          name: 'ame-la',
          license: 'MIT',
          data_version: '2026-08',
          rows: 1,
        },
      ],
    )
    assert.equal(
      (d.prepare(`SELECT value FROM meta WHERE key = 'generated_at'`).get() as {
        value: string
      }).value,
      now.toISOString(),
    )
    assert.equal(
      (d.prepare(`SELECT count(*) AS n FROM tag_source WHERE source = 2`)
        .get() as { n: number }).n,
      3,
    )
    d.close()

    // 再导入一次：后导入的覆盖，空值不覆盖，别名不重复
    await Deno.mkdir(`${dir}/b`)
    await Deno.writeTextFile(
      `${dir}/b/fix.csv`,
      'tag,zh,count,aliases\nblue_hair,,2000,蓝毛|水色头发\n',
    )
    const r2 = await importCsvFiles(db, [`${dir}/b/fix.csv`], {
      ...SOURCE,
      name: 'manual',
    })
    assert.equal(r2.seq, 3)
    assert.equal(r2.aliasesAdded, 1)
    d = read()
    const blue = tag('blue hair')
    assert.equal(blue.zh, '蓝色头发')
    assert.equal(blue.count, 2000)
    assert.equal(blue.type, 0)
    assert.equal(blue.notes, '头发是蓝色')
    d.close()
  })
})

Deno.test('csv: refuses duplicate file names, missing or old catalogs; failure leaves the catalog unchanged', async () => {
  await withTreeCatalog(async (db, dir) => {
    await Deno.mkdir(`${dir}/a`)
    await Deno.mkdir(`${dir}/b`)
    await Deno.writeTextFile(`${dir}/a/x.csv`, 'tag\nfoo\n')
    await Deno.writeTextFile(`${dir}/b/x.csv`, 'tag\nbar\n')
    await assert.rejects(
      importCsvFiles(db, [`${dir}/a/x.csv`, `${dir}/b/x.csv`], SOURCE),
      /文件名不能重复/,
    )
    await Deno.writeTextFile(`${dir}/b/bad.csv`, 'zh\nfoo\n')
    const before = await Deno.readFile(db)
    await assert.rejects(
      importCsvFiles(db, [`${dir}/a/x.csv`, `${dir}/b/bad.csv`], SOURCE),
      /没有 tag 列/,
    )
    assert.deepEqual(await Deno.readFile(db), before)
    await assert.rejects(
      importCsvFiles(`${dir}/missing.sqlite`, [`${dir}/a/x.csv`], SOURCE),
      /词库不存在/,
    )
    const old = new DatabaseSync(`${dir}/old.sqlite`)
    old.exec('PRAGMA user_version = 3; CREATE TABLE tags (id INTEGER)')
    old.close()
    await assert.rejects(
      importCsvFiles(`${dir}/old.sqlite`, [`${dir}/a/x.csv`], SOURCE),
      /不是 v4/,
    )
  })
})
