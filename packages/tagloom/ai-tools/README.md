# TagLoom · AI 工具

给 AI agent 用的命令行工具，用来帮用户给 TagLoom 里的角色补充标签。本文件夹：

- `README.md`：本说明（给 AI 读）
- `cli.ts`：命令行工具，通过 `deno task tagloom-agent` 运行
- `API.md`：底层 HTTP 接口细节（直接调接口时参考）

工具**不启动服务**，只调用正在运行的 TagLoom 服务（`deno task dev` /
`deno task start`）。在项目根目录（有 `deno.json` 的目录）运行。

## 命令

```sh
deno task -q tagloom-agent list                                   # 所有文件夹里的人物（list 艾莉丝 可按名称或路径筛选）
deno task -q tagloom-agent context 漫画A/艾莉丝.json               # 档案、标签库、分类地址 / 字段 / 当前输出
deno task -q tagloom-agent lookup 1girl blue_hair 蓝发 smiling       # 核对标签名（每个参数一条）
deno task -q tagloom-agent match "蓝色长发的少女撑着伞" --tiers exact,loose  # 描述 → 可能相关的标签 + 提到的分类
deno task -q tagloom-agent search 齐刘海 "blue jeans" --field bangs_shape   # 全库检索
deno task -q tagloom-agent tags "blue hair"                           # 标签详情（分类层级、来源）
deno task -q tagloom-agent categories dynamics.expression --limit 50  # 浏览分类（不带路径 = 根分类）
deno task -q tagloom-agent field-tags hair_color --q 蓝             # 在字段对应的词库分类内列出 / 搜索
deno task -q tagloom-agent add-tags 漫画A/艾莉丝.json <<'EOF'      # 创建标签；请求体从标准输入读取（UTF-8 JSON）
{"agentName":"my-skill","tags":[{"text":"glowing blue tattoo on left arm","label":"左臂发光蓝色纹身","fields":["recognition_mark"],"addTo":[{"segment":"base.other"}]}]}
EOF
```

- 只有这 9 个命令；没有修改、删除、改最终 Prompt 文本的命令。
- 人物用**路径**区分：人物文件在 `data/tagloom/characters/` 下的相对路径（`list`
  结果里的 `path`），例如 `漫画A/艾莉丝.json`。用户移动或改名后旧路径会报
  `not_found`，重新 `list` 即可。
- 成功时 stdout 输出 JSON；失败时 stderr 输出
  `{ code, message, details? }`，退出码 1。服务没启动时 `code` 为
  `service_unavailable`。
- 服务地址默认 `http://localhost:5175`，可用环境变量 `TAGLOOM_URL` 改，只接受
  `localhost` / `127.0.0.1`。
- 中文作为参数（如 `search 齐刘海`）或通过 heredoc /
  文件从标准输入传入都正常；工具自己按 UTF-8 发送。

## 使用方法（可直接交给 AI）

> 你可以用 `deno task -q tagloom-agent` 帮用户给 TagLoom 里的角色补充标签（在
> TagLoom 项目根目录运行，服务需已启动）。
>
> 1. `list` 找人物的 `path`（可以 `list 名称` 筛选）；`context <path>`
>    读角色档案、已有标签和各分类（`address`、`fields`、当前 `output`）。
> 2. 先查词库：自己列出候选标签用 `lookup` 核对；描述用 `match`，单个词用
>    `search`， 分类用 `categories <path>`（路径取自 `match` 的
>    `categoryHints`）。 词库里有贴切的 canonical
>    时不要创建自创标签，把建议告诉用户即可。
> 3. 词库里没有时，用 `add-tags <path>`（JSON
>    从标准输入）创建自创标签，`agentName` 填你的名字；需要直接放进某个分类时加
>    `addTo`，它会作为**勾选**条目改变输出。
> 4. 只追加，不要重复创建已有标签（重复文本会被复用）；结果里的 `skipped`
>    说明了哪些没写入及原因。

## 词库查询命令

- `lookup` / `match` / `search` / `tags` / `categories`
  的每个参数是一条查询，含空格加引号。
- 返回字段见 [API.md](API.md)「词库查询」。`lookup` 的 `status`：`exact` /
  `label` / `alias` / `ambiguous`（看 `tags` 选一个）/ `none`（`suggestions`
  仅供参考）。
- 分页（`match` / `search` / `categories`）：每页最多 100 条；结果里有
  `nextOffset` 就加 `--offset <nextOffset> --catalog-version <catalogVersion>`
  再查那一条；有 `total` 没有 `nextOffset` 是最后一页。 报 `catalog_changed`
  时去掉 `--offset` 从第一页重查。

## add-tags 请求体

```jsonc
{
  "agentName": "my-skill", // 必填，1–100 字，记录在标签和条目的来源上
  "tags": [ // 1–50 个
    {
      "text": "glowing blue tattoo on left arm", // 必填，写进 Prompt 的原文，可带权重
      "label": "左臂发光蓝色纹身", // 可选，中文说明
      "fields": ["recognition_mark"], // 可选，建议归属的字段 key（见 context 的 segments[].fields）；空 = 所有字段都显示
      "note": "档案第 2 段提到", // 可选
      "addTo": [ // 可选：同时作为勾选条目加进这些分类（最多 20 个）
        { "segment": "base.other", "field": "recognition_mark" } // segment 用 context 返回的 address；field 可省略
      ]
    }
  ]
}
```

返回 `{ version, created, reused, items, skipped }`：`reused`
是标签库里已有相同文本（不分大小写）而复用的标签；`skipped`
是没写入的部分及原因（未知字段、分类不存在等），其余照常写入。

分类地址：`base.<hair|eyes|body|other>`、`combo.<组合id>.<overall|top|bottom|outer|legwear|footwear|accessory|onepiece|underwear_upper|underwear_lower|underwear_other|hair_override>`。

## 规则

- **只能追加**：新增标签、把标签作为勾选条目加进分类。不能修改或删除已有内容，也不能确认事实、改字段状态——这些由用户在编辑页操作。
- **来源固定为 AI**：创建的标签和条目一律记为 `origin: "agent"`（界面显示 🤖
  AI），并记下 `agentName` 和时间。
- 用户正开着编辑页也没关系：编辑页会自动拉取并合并 AI
  写入，用户保存时也会自动合并，不会冲突或丢失用户未保存的修改。
- `pending_limit` 错误：用户超过 200 次 AI
  写入都没保存过这个人物，需要请用户先在编辑页保存。

## 安全与权限

- `deno task tagloom-agent` 固定了 Deno 权限：只能连本机网络、只能读
  `TAGLOOM_URL` 环境变量；**不能读写文件、读其他环境变量（如
  `NOVELAI_TOKEN`）、连外网或启动子进程**（已实测全部被拒绝）。
- HTTP 接口本身不鉴权（可信内网）。如果 AI
  还有其他执行命令的权限，它仍可能绕过本工具直接调接口；要真正限定能力，需要同时收紧它的其他权限。

只允许 AI 调用这个工具（Claude Code 示例，写在使用 AI 的那个项目的
`.claude/settings.json`，按需合并到已有配置）：

```json
{
  "permissions": {
    "allow": [
      "Bash(deno task -q tagloom-agent:*)",
      "Bash(deno task tagloom-agent:*)"
    ]
  }
}
```
