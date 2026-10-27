# agent 词库批量接口（`/agent/catalog/*`）设计

> **状态：已实现**（2026-10-13）。接口和命令的用法见
> `../ai-tools/API.md`、`../ai-tools/README.md`（给 AI 读）；
> 本文记录设计理由、分页规则与项目前提，给开发者看。代码：`core/agent-catalog.ts`、`server/api/mod.ts`，
> 测试：`server/agent_catalog_api_test.ts`。
>
> **写给 AI 的文档（`../ai-tools/README.md`、`API.md`）只写怎么查**：有哪些命令
> / 接口、参数、返回字段、 分页规则（第 5 节第 1–7
> 条的结论）。本文的理由、前提、方案比较一律不写进去，节约 AI 的 token。

## 1. 背景与决定

### 为什么给 AI 提供查询工具，而不是让它直接查 SQLite

|        | 通过工具                                                                           | AI 直接查 SQLite                                                                    |
| ------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 正确性 | 规范化（库里不存规范化后的写法）、分类后代、中文名的回退规则、受限标签过滤都已封装 | 要先读懂 `CATALOG_DB.md` 再写 SQL，出错时不报错，只是悄悄漏掉或查错                 |
| 稳定性 | 返回 canonical + 词库版本，词库重建后照常可用                                      | 表结构一改查询就失效                                                                |
| 安全   | `deno task tagloom-agent` 只能连本机网络，不能读写文件、读其他环境变量             | 要给文件读取权限（数据目录里还有人物 JSON）；sqlite3 命令行默认可写；受限过滤拦不住 |
| 成本   | 一次调用拿到分层、带依据的结果                                                     | 多轮看表结构、试查询，耗 token                                                      |
| 一致性 | 与 `/tagloom/match` 页面结果相同，用户可复核                                       | 每次查法不同，结果不可复现                                                          |
| 灵活性 | 只有工具提供的查询                                                                 | 任意查询                                                                            |

结论：AI 只用工具。临时的数据分析由开发者跑一次性脚本，不给 AI 常驻数据库权限。

### 分工：AI 负责意思，工具负责核对

`match` 只按字面匹配（「很开心 → smile」「少女 → 1girl」找不到）。AI 熟悉
danbooru 标签，所以推荐流程是：

1. AI 读描述，自己列出候选英文标签。
2. `lookup` 批量核对：是否在词库、规范写法、别名 /
   中文名对应到哪个标签、找不到时的相近标签——避免编造。
3. `match` 做字面召回补漏，`categories` 浏览提到的分类，`tags` 看详情。

## 2. 命名

- 前缀 `/agent/catalog/`：和已有的 agent
  接口（`/agent/characters`、`/agent/character/custom-tags`）放在一起，
  一看就知道是给 AI 用的、只读或只追加。
- 接口名不加 `batch` /
  `bulk`：这一组**全部**是批量接口，约定写在一处即可。需要在名字里体现时用
  `batch` （一次请求做多件同类的事），不用 `bulk`（多指大量导入导出）；不用
  `:batchGet` 写法（Hono 会当成路由参数）。
- 页面接口 `/catalog/*` 只给页面用；命令行工具改为调用
  `/agent/catalog/*`，两边以后各自演进。

## 3. 接口

全部 `POST`，请求体 JSON。

| 接口                        | 请求                                       | 用途                           | 分页 |
| --------------------------- | ------------------------------------------ | ------------------------------ | ---- |
| `/agent/catalog/lookup`     | `{ tags: string[] }`                       | 核对 AI 提出的标签             | 否   |
| `/agent/catalog/match`      | `{ queries: [{ text, tiers?, offset? }] }` | 自然语言粗筛                   | 是   |
| `/agent/catalog/search`     | `{ queries: [{ q, field?, offset? }] }`    | 全库检索                       | 是   |
| `/agent/catalog/tags`       | `{ canonicals: string[] }`                 | 标签详情（分类链、来源）       | 否   |
| `/agent/catalog/categories` | `{ queries: [{ path?, q?, offset? }] }`    | 浏览分类（path 为空 = 根分类） | 是   |

命令行工具的命令名与接口名一致，参数可以一次给多个：

```sh
deno task -q tagloom-agent lookup 1girl smile blue_hair 蓝发
deno task -q tagloom-agent categories dynamics.expression character.body.hair --limit 30
```

## 4. 通用约定

- 一个请求最多 20 条查询（`lookup` / `tags` 最多 100 个）。
- 每条结果带 `input`（原样回显请求里的这一条），不靠顺序对应。
- 单条出错只在那一条写 `error: { code, message }`，不让整个请求失败（与
  `add-tags` 的 `skipped` 同理）。
- 每个响应都带 `catalogVersion`。
- 词库不可用时整个响应为 `{ verified: false, reason }`，不等于「没有结果」。

## 5. 分页

1. 每条查询各自分页。
2. 每页最多 100 条：`limit` 可在 1–100 之间调小，超过 100 按 100 处理。
3. **没有超过上限**：只返回 `items`，不带分页字段。
4. **只要分了页，每一页（含最后一页）都带 `total`**；还有下一页时再带
   `nextOffset`。 AI 看到 `nextOffset` 就知道还有更多，看到 `total` 而没有
   `nextOffset` 就是最后一页。
5. 翻页：只为需要翻页的那几条发请求，带 `offset`（取上一页的 `nextOffset`）。
6. 分类信息、子分类、`categoryHints`、`unmatched`
   这类附加信息只在第一页（`offset` 为 0）返回。
7. 版本检查（可选）：翻页时可以把第一页的 `catalogVersion`
   带回来；带了且与当前不一致， 那一条返回 `error.code = "catalog_changed"`，AI
   从第一页重新查。不带就不检查；`offset` 为 0 的查询本来就是第一页，不受影响。
8. 列表里的标签只给 `{ canonical, labelZh, categoryPath, postCount }`（节约
   token）；完整信息用 `tags`。

用 offset 而不是游标或快照：见第 6 节的前提。

## 6. 项目前提（为什么这样设计就够了）

- **运行时一般不会修改词库。** TagLoom 只读打开 `tag_catalog.sqlite`，从不写入。
- **超过 100 条的情况比较少。** `lookup` / `tags` 每条结果本身就小；`match`
  按层筛选（先只要 `exact`、`loose`）通常远少于 100
  条；只有浏览大分类或宽泛的检索才会分页。
- **agent 一般是短时间内分段查询**（几秒到几分钟），这期间词库变化的可能性很小。

因此不做游标、快照或结果缓存，按 offset 翻页即可；可选的版本检查用来兜底。

### 翻页途中词库会变的情况（都需要人手动操作并重启服务）

| 情况                                                                                              | 结果                                                                                          | 版本检查能否发现              |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------- |
| 重建 / 替换了 `tag_catalog.sqlite` 并重启服务（服务运行时持有旧文件的只读连接，不重启读不到新库） | 版本号（`schema_version` + `generated_at`）变化；排序、数量可能变，按 offset 翻页会重复或漏掉 | ✅ 能                         |
| 改了 `TAGLOOM_CATALOG_PATH` 指向另一个词库并重启                                                  | 同上                                                                                          | ✅ 能（两个库的生成时间不同） |
| 打开 / 关闭 `TAGLOOM_ALLOW_RESTRICTED` 并重启                                                     | 总数和顺序变化                                                                                | ❌ 不能（版本号不变）         |
| 更新 TagLoom 代码（如 `match` 的匹配规则）并重启                                                  | `match` 的结果和顺序可能变化                                                                  | ❌ 不能                       |

后两种本来就要人工重启服务，影响很小，不专门处理。

## 7. 例子

数字按当前词库估算，以实现后为准。

### 7.1 浏览分类：第一页

```jsonc
// POST /api/tagloom/agent/catalog/categories
{
  "queries": [
    { "path": "character.body.hair" }, // 414 个标签，超过上限
    { "path": "dynamics.expression.emotion.shy" }, // 5 个，没超过
    { "path": "no.such.category" } // 不存在
  ],
  "limit": 100
}
```

```jsonc
{
  "verified": true,
  "catalogVersion": "v3@2026-09-27T04:04:55.425Z",
  "results": [
    {
      "input": { "path": "character.body.hair" },
      "category": {
        "path": "character.body.hair",
        "labelZh": "头发",
        "tagCount": 414
      },
      "ancestors": [{ "path": "character", "labelZh": "角色" }, {
        "path": "character.body",
        "labelZh": "身体"
      }],
      "children": [{
        "path": "character.body.hair.color",
        "labelZh": "颜色",
        "tagCount": 56
      }],
      "items": [{
        "canonical": "long hair",
        "labelZh": "长发",
        "postCount": 5543219
      }], // 共 100 条
      "total": 414,
      "nextOffset": 100
    },
    {
      "input": { "path": "dynamics.expression.emotion.shy" },
      "category": {
        "path": "dynamics.expression.emotion.shy",
        "labelZh": "害羞",
        "tagCount": 5
      },
      "ancestors": [],
      "children": [],
      "items": [{
        "canonical": "embarrassed",
        "labelZh": "赤面",
        "postCount": 124510
      }] // 共 5 条；没分页，所以没有 total / nextOffset
    },
    {
      "input": { "path": "no.such.category" },
      "error": {
        "code": "not_found",
        "message": "词库里没有分类 no.such.category"
      }
    }
  ]
}
```

### 7.2 浏览分类：只翻第一条

```jsonc
// POST /api/tagloom/agent/catalog/categories
{
  "catalogVersion": "v3@2026-09-27T04:04:55.425Z",
  "queries": [{ "path": "character.body.hair", "offset": 100 }]
}
```

```jsonc
{
  "verified": true,
  "catalogVersion": "v3@2026-09-27T04:04:55.425Z",
  "results": [{
    "input": { "path": "character.body.hair", "offset": 100 },
    "items": [], // 第 101–200 条
    "total": 414,
    "nextOffset": 200
  }]
}
```

最后一页（`offset: 400`）：`items` 14 条、`total: 414`，没有 `nextOffset`。

### 7.3 自然语言粗筛：只要高可信的两层

```jsonc
// POST /api/tagloom/agent/catalog/match
{
  "queries": [
    {
      "text": "一个蓝色长发的少女穿着水手服，在雨中撑着伞",
      "tiers": ["exact", "loose"]
    },
    { "text": "a girl holding an umbrella in the rain" }
  ]
}
```

```jsonc
{
  "verified": true,
  "catalogVersion": "v3@…",
  "results": [
    {
      "input": {
        "text": "一个蓝色长发的少女穿着水手服，在雨中撑着伞",
        "tiers": ["exact", "loose"]
      },
      "items": [
        {
          "canonical": "serafuku",
          "labelZh": "水手服",
          "tier": "exact",
          "categoryPath": "apparel.garment.uniform.school.generic",
          "hits": [{ "text": "水手服", "term": "水手服" }]
        },
        {
          "canonical": "holding umbrella",
          "labelZh": "撑伞",
          "tier": "loose",
          "hits": [{ "text": "撑着伞", "term": "撑伞" }]
        }
      ], // 共约 10 条，没分页
      "categoryHints": [],
      "unmatched": ["一个", "的少女穿着"]
    },
    {
      "input": { "text": "a girl holding an umbrella in the rain" },
      "items": [], // 共 100 条
      "total": 124,
      "nextOffset": 100,
      "categoryHints": [],
      "unmatched": ["girl"]
    }
  ]
}
```

`tiers` 默认四层（`exact` / `loose` / `related` / `single`）都要。

### 7.4 批量核对（不分页）

```jsonc
// POST /api/tagloom/agent/catalog/lookup
{ "tags": ["1girl", "Blue_Hair", "蓝发", "smiling", "sunset glow"] }
```

```jsonc
{
  "verified": true,
  "catalogVersion": "v3@…",
  "results": [
    { "input": "1girl", "status": "exact", "tag": { "canonical": "1girl" } },
    {
      "input": "Blue_Hair",
      "status": "exact",
      "tag": { "canonical": "blue hair" }
    }, // 规范化后一致
    { "input": "蓝发", "status": "label", "tag": { "canonical": "blue hair" } }, // 中文 / 日文名
    { "input": "smiling", "status": "alias", "tag": { "canonical": "smile" } }, // 别名
    {
      "input": "sunset glow",
      "status": "none",
      "suggestions": [{ "canonical": "sunset", "labelZh": "日落" }]
    }
  ]
}
```

- `status`：`exact`（规范化后与 canonical 相同）/ `label`（中文、英文、日文名）/
  `alias` / `ambiguous`（一个名字对应多个标签，返回 `tags` 数组让 AI
  选；词库里有 263 个中文名、15 个别名是这样）/ `none`（返回 `suggestions`）。
- `tag` 实际包含 `labelZh`、`categoryPath`、`postCount` 等字段，例子里省略。
