// 手动脚本：用真实词库试几个检索，只读。
// deno run --allow-read packages/tagloom/script/catalog_smoke.ts [词库路径]
import { openSqliteCatalog } from '../infra/mod.ts'

const path = Deno.args[0] ?? './data/tagloom/tag_catalog.sqlite'
const cat = openSqliteCatalog({ path })
console.log(cat.status())
const show = (
  label: string,
  rows: {
    canonical: string
    labelZh: string
    match?: string
    evidence?: string
    inField?: boolean
    categoryPath: string
  }[],
) => {
  console.log(`\n# ${label}`)
  for (const r of rows) {
    console.log(
      ' ',
      r.canonical,
      '|',
      r.labelZh,
      '|',
      r.match ?? '',
      r.evidence ?? '',
      r.inField ? '[field]' : '',
      r.categoryPath,
    )
  }
}
for (
  const [q, paths] of [
    ['蓝色', ['character.body.hair.color']],
    ['齐刘海', ['character.body.hair.bangs']],
    ['蓝色牛仔裤', ['apparel.garment.bottom']],
    ['blue hair', []],
    ['白色无袖上衣', ['apparel.garment.top']],
  ] as const
) {
  const t0 = performance.now()
  show(
    `search ${q} (${(performance.now() - t0).toFixed(0)}ms)`,
    cat.search(q, 6, [...paths]),
  )
}
show('list bangs', cat.listInCategories(['character.body.hair.bangs'], '', 6))
show(
  'list hair color q=蓝',
  cat.listInCategories(['character.body.hair.color'], '蓝', 6),
)
cat.close()
