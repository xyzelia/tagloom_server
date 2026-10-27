# TagLoom · AI agent HTTP 接口

给 AI agent / Skill 调用的 HTTP
接口：读取人物、查词库、往**角色标签库**添加自创标签，并可以直接把标签作为**勾选的条目**加进某个分类（会改变该分类的输出）。

- 基础地址：`http://<主机>:<端口>/api/tagloom`（默认 5175，开发和生产相同）
- **不鉴权**：和页面接口一样，假设运行在可信内网；能访问端口的程序都能调用。部署到不可信网络前必须加鉴权。
- agent **只能追加**：新增标签、加入条目。不能修改或删除已有标签 /
  条目，也不能确认事实、改字段状态——这些都由用户在编辑页操作。
- 来源由服务端写死：agent 创建的标签和条目一律记为
  `origin: "agent"`，并记录请求里的 `agentName` 和服务端时间。请求里写 `origin`
  无效。
- 错误响应统一为 `{ code, message, details? }`：404 `not_found`；409
  `pending_limit`；422 `invalid_request`（包括路径格式不对）。
- **人物用路径区分**：`path` 是人物文件在 `data/tagloom/characters/`
  下的相对路径，用 `/` 分隔，例如 `漫画A/第1卷/艾莉丝.json`。没有单独的
  id；用户移动或改名文件后路径就变了， 旧路径会返回 404，重新
  `GET /agent/characters` 取新路径即可。路径放在查询参数里，记得 URL 编码。

> AI 一般用命令行工具即可，见同目录的
> [README.md](README.md)。本文是工具底层调用的 HTTP 接口细节。

## 推荐调用顺序

1. `GET /agent/characters`（或 `?q=名称`）找到人物的 `path`。
2. `GET /agent/character?path=…` 读档案、标签库里已有的标签、每个分类的地址 /
   可用字段 / 当前输出。
3. 先查词库（`POST /agent/catalog/*`）：自己列出的候选标签用 `lookup`
   核对，描述用 `match`，单个词用 `search`，`match` 提到的分类用 `categories`
   浏览。**词库里已有贴切的 canonical
   时不要创建自创标签**（词库标签由用户在编辑页选用）。
4. 确实没有时，`POST /agent/character/custom-tags?path=…` 创建，需要时用 `addTo`
   直接加进分类。

## GET /agent/characters

所有文件夹里的人物（服务端会把每个子文件夹都读一遍），按最后修改时间倒序：
`[{ path, version, title, comboCount, updatedAt }]`。可选
`?q=文本`：按名称或路径筛选（不分大小写）。
所有时间字段（`updatedAt`、`createdAt` 等）都是 epoch 毫秒数字。

## GET /agent/character?path=…

```jsonc
{
  "path": "漫画A/艾莉丝.json", "version": 5, "title": "…", "profile": "角色档案原文", "subject": "1girl",
  "customTags": [{ "id": "…", "text": "star-shaped ahoge", "label": "星形呆毛", "fields": ["hair_extra_structure"], "origin": "user", "agentName": "" }],
  "combos": [{ "id": "c1", "name": "日常", "hairOverrideEnabled": false }],
  "segments": [
    {
      "address": "base.hair",            // 写入时用这个地址
      "label": "Base · 头发",
      "fields": [{ "key": "hair_color", "label": "发色", "optional": false }, …],
      "output": "blue hair, (long hair:1.2)",   // 当前输出（勾选条目按顺序连接）
      "items": [{ "text": "blue hair", "included": true, "kind": "catalog", "origin": "user" }, …]
    },
    { "address": "combo.c1.top", "label": "日常 · 上装", … },
    { "address": "combo.c1.hair_override", "label": "日常 · 发型覆盖（未启用）", … }
  ]
}
```

分类地址：`base.<hair|eyes|body|other>`、`combo.<组合id>.<overall|top|bottom|outer|legwear|footwear|accessory|onepiece|underwear_upper|underwear_lower|underwear_other|hair_override>`。

人物状态的分类也出现在 `segments` 中：

- `combo.<组合id>.state.<状态id>.expression`：神态与表情，字段 `expression`。
- `combo.<组合id>.state.<状态id>.action`：动作与姿势，字段 `action`。
- `combo.<组合id>.state.<状态id>.override.<base.分类|costume.分类>`：已配置的外观／服饰覆盖内容。

覆盖地址只列出用户已经配置的分类；AI 追加保留其 `append`／`replace`
模式，不自动创建覆盖。 状态、种子和覆盖模式由用户在编辑页管理，agent 仅追加条目。

## 词库查询 `POST /agent/catalog/*`

请求体都是 JSON，一次可查多条；每条结果带
`input`（原样回显这一条），单条出错写在它的 `error: { code, message }`
里（`not_found` / `invalid_request` / `catalog_changed`），不影响其他条。
响应：`{ verified: true, catalogVersion, results: [...] }`；`verified: false`
表示词库不可用（未进行数据库核查），不等于「无匹配」。 标签统一为
`{ canonical, labelZh, categoryPath, postCount }`。

| 接口         | 请求体                                                              | 每条结果                                                                                       |
| ------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `lookup`     | `{ tags: ["1girl", "蓝发", …] }`（≤100）                            | `status`：`exact` / `label` / `alias` 带 `tag`；`ambiguous` 带 `tags`；`none` 带 `suggestions` |
| `tags`       | `{ canonicals: ["blue hair", …] }`（≤100）                          | `tag`：完整信息（三语名、别名、`categoryTrail` 分类层级、`sourceRecords` 来源）                |
| `match`      | `{ queries: [{ text, tiers?, offset? }], limit?, catalogVersion? }` | `items`（加 `tier`、`hits[{ text, term }]`）；第一页另有 `categoryHints`、`unmatched`          |
| `search`     | `{ queries: [{ q, field?, offset? }], limit?, catalogVersion? }`    | `items`（加 `match`、`evidence`；带 `field` 时加 `inField`）                                   |
| `categories` | `{ queries: [{ path?, q?, offset? }], limit?, catalogVersion? }`    | `items`；第一页另有 `category`、`ancestors`、`children`。`path` 为空 = 根分类                  |

- `queries` 最多 20 条。`tiers` 取 `exact` / `loose` / `related` /
  `single`，默认全部。
- **分页**（`match` / `search` / `categories`，每条各自分页）：`limit`
  1–100，默认 100，超过按 100。 没超过上限只返回 `items`；分了页的每一页都带
  `total`，还有下一页时带 `nextOffset`。 翻页：该条带 `offset: nextOffset`
  再查，并把第一页的 `catalogVersion` 放进请求； 返回 `catalog_changed`
  时从第一页重查。

```jsonc
// POST /agent/catalog/categories
{ "queries": [{ "path": "character.body.hair" }, { "path": "dynamics.expression.emotion.shy" }] }
// →
{ "verified": true, "catalogVersion": "v3@…", "results": [
  { "input": { "path": "character.body.hair" }, "category": { "path": "character.body.hair", "labelZh": "头发", "tagCount": 414 },
    "ancestors": [ … ], "children": [ … ], "items": [ … 100 条 ], "total": 414, "nextOffset": 100 },
  { "input": { "path": "dynamics.expression.emotion.shy" }, "category": { … }, "ancestors": [ … ], "children": [], "items": [ … 5 条 ] }
] }
```

`GET /catalog/field-tags?field=bangs_shape&q=齐`：只在字段对应的词库分类内列出（页面接口）。

## POST /agent/character/custom-tags?path=…

```jsonc
{
  "agentName": "my-skill", // 必填，1–100 字
  "tags": [ // 1–50 个
    {
      "text": "glowing blue tattoo on left arm", // 必填，写进 Prompt 的原文，可带权重
      "label": "左臂发光蓝色纹身", // 可选，中文说明
      "fields": ["recognition_mark"], // 可选，建议归属的字段 key；空 = 所有字段都显示
      "note": "档案第 2 段提到", // 可选
      "addTo": [ // 可选：同时作为勾选条目加进这些分类（最多 20 个）
        { "segment": "base.other", "field": "recognition_mark" } // field 可省略：取 fields 中属于该分类的第一个
      ]
    }
  ]
}
```

返回：

```jsonc
{
  "version": 6, // 写入后的人物版本；什么都没写入时不变
  "created": [{ "id": "…", "text": "…", "label": "…" }],
  "reused": [{ "id": "…", "text": "…" }], // 标签库已有相同文本（不分大小写）：不重复创建，addTo 用已有标签
  "items": [{ "segment": "base.other", "text": "…" }],
  "skipped": [
    "「x」：未知字段 no_such_field",
    "「y」：分类 combo.nope.top 不存在"
  ]
}
```

- 部分内容不合法时只跳过这部分（写在 `skipped` 里），其余照常写入。
- 同一分类已有同一个自创标签的条目时不重复添加，只把它重新勾选。
- `pending_limit`（409）：用户超过 200 次 AI
  写入都没保存过这个人物，需要用户先在编辑页保存。

示例：

```sh
curl -s -X POST 'http://localhost:5175/api/tagloom/agent/character/custom-tags?path=<URL 编码后的路径>' \
  -H 'content-type: application/json' \
  -d '{"agentName":"my-skill","tags":[{"text":"glowing blue tattoo on left arm","label":"左臂发光蓝色纹身","fields":["recognition_mark"],"addTo":[{"segment":"base.other"}]}]}'
```

> **Windows 注意**：在 Git Bash / PowerShell 里把含中文的 JSON 直接写在
> `-d '...'` 参数里， 中文会在传给 curl 之前被系统代码页转换成 `?`（实测 `label`
> 变成 `????`）。请把请求体存成 UTF-8 文件再发送：
> `curl ... -H 'content-type: application/json; charset=utf-8' --data-binary @body.json`。
> 程序里直接发 HTTP 请求（fetch、requests 等，UTF-8 编码）不受影响。

## 与正在打开的编辑页

- 编辑页每 15 秒（以及切回页面时）拉取 AI 写入，合并到正在编辑的内容并提示「🤖
  AI（名称）新增了 N 个标签、M 个条目」。
  页面在后台（标签页不可见）时不定时拉取，切回页面时立即拉取一次。
- 如果用户在拉取之前就保存，服务端会把这些 AI
  写入合并进用户提交的内容后保存，不会因此报冲突。
- 合并后用户删掉的 AI
  条目不会被再次加回。用户在别处（另一个标签页）真正改过时仍按版本冲突处理。
