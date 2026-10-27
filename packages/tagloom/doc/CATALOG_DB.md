# 标签词库数据库（tag_catalog.sqlite，v4）

词库的表结构、数据来源、导入规则、TagLoom 的读取方式和词库页。

- 文件：`data/tagloom/tag_catalog.sqlite`（可用 `TAGLOOM_CATALOG_PATH`
  指到别处）。
- 由导入工具生成（第 10 节），TagLoom 只读，从不写入。
- **进度**：tags-tree 导入、CSV 导入（命令行和词库页）、TagLoom
  读取（含说明检索）已实现；不做按记录重建。

- 以
  [Jannchie/danbooru-tags-tree](https://github.com/Jannchie/danbooru-tags-tree)
  为主体：分类树、标签归属、三语名称、频次、受限判断都来自它。
- 其他数据（如
  [ame-la/danbooru-tags-data-zh](https://huggingface.co/datasets/ame-la/danbooru-tags-data-zh)）
  以固定表头的 CSV 导入，只作附加信息，后导入的覆盖先导入的。
- 不再使用 wfjsw（AGPL-3.0，2022 年后停更）。
- 库里只有基础数据；检索用的索引在 TagLoom 加载时于内存里生成（第 9 节）。

## 1. 总览

| 表           | 内容                        | 写入方         |
| ------------ | --------------------------- | -------------- |
| `meta`       | 词库元数据                  | 生成工具       |
| `category`   | 分类树（只存名称）          | tags-tree      |
| `tag`        | 标签：tags-tree 列 + CSV 列 | tags-tree、CSV |
| `tag_alias`  | 别名                        | CSV            |
| `tag_source` | 哪些导入提到过这个标签      | tags-tree、CSV |
| `import_log` | 导入记录（每个文件一行）    | 生成工具       |

- **不用整数 id**：标签以 `name`、分类以 `path` 为主键。用户文件只存 canonical
  和词库版本，接口也不返回 id；读取代码需要整数时在加载时自己编号。
- `PRAGMA user_version = 4`。

## 2. 规范化（`normalizeTerm`）

```ts
value.normalize('NFKC').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ')
  .trim()
```

`tag.name` 是规范化后的写法（`blue_hair` → `blue hair`），原始写法存在
`tag.source_key`。三语名称、别名都保留原样写法，读取时再规范化后匹配。

## 3. 表结构

### meta

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
```

键：`schema_version`（`4`）、`generated_at`（ISO
时间）、`tag_count`、`alias_count`。

词库版本号 = `v{schema_version}@{generated_at}`，记在用户的标签引用里
（`TagRef.catalogVersion`）。**每次导入都要更新 `generated_at`**。

### category

```sql
CREATE TABLE category (
  path     TEXT PRIMARY KEY,         -- character.body.hair.color
  label_en TEXT NOT NULL DEFAULT '',
  label_ja TEXT NOT NULL DEFAULT '',
  label_zh TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;
```

- 只来自 tags-tree，路径写法不变（`share/fields.ts`、`share/tag-targets.ts`
  依赖这些路径）。
- 不存父分类：父分类 = 路径去掉最后一段，读取时计算（已核对 927
  个分类全部成立，各段不含 `.`）。
- 不设 `_uncategorized` 兜底分类：没有分类的标签 `tag.category_path` 为 NULL。
- 分类的三语名称只在这里有，列表、详情分类层级、分类浏览、标签筛选的分类提示都要用。

### tag

```sql
CREATE TABLE tag (
  name          TEXT PRIMARY KEY,                    -- 规范化后的标签名
  source_key    TEXT NOT NULL,                       -- 原始写法，先写入的一方决定
  -- tags-tree 列（CSV 不改动）
  category_path TEXT REFERENCES category(path),      -- NULL = 没有分类
  label_en      TEXT NOT NULL DEFAULT '',
  label_ja      TEXT NOT NULL DEFAULT '',
  label_zh      TEXT NOT NULL DEFAULT '',
  post_count    INTEGER NOT NULL DEFAULT 0 CHECK (post_count >= 0),
  restricted    INTEGER NOT NULL DEFAULT 0 CHECK (restricted IN (0, 1)),
  -- CSV 列（tags-tree 不写）
  type          INTEGER CHECK (type IN (0, 1, 3, 4, 5)),
  zh            TEXT NOT NULL DEFAULT '',
  count         INTEGER CHECK (count >= 0),
  notes         TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;
```

| 列              | 写入方    | 含义                                                            | 例（blue hair）             | 例（highres，只在 CSV 里有） |
| --------------- | --------- | --------------------------------------------------------------- | --------------------------- | ---------------------------- |
| `name`          | 两者      | 规范化后的标签名，即身份                                        | `blue hair`                 | `highres`                    |
| `source_key`    | 先写入方  | 原始写法；已有时 CSV 不改                                       | `blue_hair`                 | `highres`                    |
| `category_path` | tags-tree | 所在分类                                                        | `character.body.hair.color` | NULL                         |
| `label_en`      | tags-tree | 英文名（99.6% 与 name 相同，仍保留：含义不同）                  | `blue hair`                 | `''`                         |
| `label_ja`      | tags-tree | 日文名                                                          | `青髪`                      | `''`                         |
| `label_zh`      | tags-tree | 中文名（tags-tree 从 danbooru-tag-index 同步，经过审校）        | `蓝发`                      | `''`                         |
| `post_count`    | tags-tree | tags-tree 频次 CSV 的值                                         | 1088813                     | 0                            |
| `restricted`    | tags-tree | 根分类为 `explicit` 时为 1；CSV 新建的标签一律为 0              | 0                           | 0                            |
| `type`          | CSV       | Danbooru 标签类型：0 通用 / 1 画师 / 3 作品 / 4 角色 / 5 元标签 | 0                           | 5                            |
| `zh`            | CSV       | CSV 的中文名                                                    | （CSV 的值）                | `高分辨率`                   |
| `count`         | CSV       | CSV 的图片数                                                    | （CSV 的值）                | 8033637                      |
| `notes`         | CSV       | 一句话说明                                                      | （CSV 的值）                | `宽至少1600像素…`            |

tags-tree 列和 CSV 列互不重叠：CSV 永远不会改动 tags-tree
的分类、名称、频次、受限标记。

### tag_alias

```sql
CREATE TABLE tag_alias (
  name   TEXT NOT NULL REFERENCES tag(name),
  term   TEXT NOT NULL,        -- 别名原样写法，如 yellow_hair、金毛
  source INTEGER NOT NULL,     -- 写入它的导入，= import_log.seq
  PRIMARY KEY (name, term, source)
) WITHOUT ROWID;
```

用途：检索（搜 `yellow hair` 找到 `blonde hair`）、核对（图片导入、agent 接口里
`hires` 认成 `highres`，状态为「别名」）、标签详情、标签筛选。

- tags-tree 没有别名，数据全部来自 CSV 的 `aliases`。
- 别名混有中英日文，表里不区分语言，核对时统一返回「别名」。
- 一个别名可能对应多个标签（尤其画师），核对时返回「有歧义」并列出候选。

### tag_source

```sql
CREATE TABLE tag_source (
  name       TEXT NOT NULL REFERENCES tag(name),
  source     INTEGER NOT NULL,   -- = import_log.seq
  source_key TEXT NOT NULL,      -- 该导入里的原始写法
  PRIMARY KEY (name, source)
) WITHOUT ROWID;
```

标签详情的「来源」用它：`source` → `import_log.name`。

### import_log

每个导入的文件一行；同一次导入的公共信息在各行重复（允许冗余）。

```sql
CREATE TABLE import_log (
  seq          INTEGER NOT NULL,             -- 第几次导入：1 = tags-tree，2、3 … = CSV
  path         TEXT NOT NULL,                -- tags-tree：仓库内相对路径；CSV：文件名
  kind         TEXT NOT NULL CHECK (kind IN ('tags-tree', 'csv')),
  name         TEXT NOT NULL,                -- tags-tree / ame-la / manual …
  repository   TEXT NOT NULL DEFAULT '',     -- 仓库或下载地址（见第 7 节）
  revision     TEXT NOT NULL DEFAULT '',     -- tags-tree：git commit；CSV：可空
  dirty        INTEGER NOT NULL DEFAULT 0,   -- tags-tree 仓库有未提交修改时为 1
  license      TEXT NOT NULL DEFAULT '',
  data_version TEXT NOT NULL DEFAULT '',     -- tags-tree：_meta.version；CSV：手填，如 2026-08
  imported_at  TEXT NOT NULL,                -- ISO 时间
  sha256       TEXT NOT NULL,                -- 这个文件的哈希
  bytes        INTEGER NOT NULL,
  rows         INTEGER,                      -- CSV 数据行数；YAML 留空
  PRIMARY KEY (seq, path)
) WITHOUT ROWID;
```

例：

| seq | path                                                 | kind      | name      | revision   | license     | data_version |   rows |
| --: | ---------------------------------------------------- | --------- | --------- | ---------- | ----------- | ------------ | -----: |
|   1 | `data/source/danbooru_tag_tree_v3.yaml`              | tags-tree | tags-tree | `8ec5bfe…` | UNSPECIFIED | 3.9          |        |
|   1 | `data/source/danbooru_tag_tree_v3.multilingual.yaml` | tags-tree | tags-tree | `8ec5bfe…` | UNSPECIFIED | 3.9          |        |
|   1 | `data/source/tag_frequency_general.csv`              | tags-tree | tags-tree | `8ec5bfe…` | UNSPECIFIED | 3.9          | 101886 |
|   2 | `general.csv`                                        | csv       | ame-la    |            | MIT         | 2026-08      |  30693 |
|   2 | `meta.csv`                                           | csv       | ame-la    |            | MIT         | 2026-08      |    580 |

tags-tree 同时记 commit 和文件哈希：仓库有本地修改（`dirty = 1`）或是没有 `.git`
的 zip 时，靠哈希识别内容。

## 4. tags-tree 导入

读取仓库 `data/source/` 下 3 个文件（`ja-zh-homographs.txt`
只用于上游校验，不导入）：

| 文件                                     | 内容                                                           | 写到                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `danbooru_tag_tree_v3.yaml`              | 嵌套分类树，叶子是标签列表（`blue_hair`）；`_meta.version`     | `category.path`、`tag.name` / `source_key` / `category_path`、`import_log.data_version` |
| `danbooru_tag_tree_v3.multilingual.yaml` | `category.<path>` 和 `tag.<原始写法>` 的 `en` / `ja` / `zh-CN` | `category.label_*`、`tag.label_*`                                                       |
| `tag_frequency_general.csv`              | `tag,count`                                                    | `tag.post_count`（只取分类树里的标签）                                                  |

- `category.path` = YAML 各层键用 `.` 连接；`_meta` 不是分类。
- `tag.restricted` = 根分类为 `explicit`。
- `import_log`：`repository` 取 git remote（见第 7 节），`revision` 取
  `git rev-parse HEAD`，`dirty` 取 `git status --porcelain`
  是否有输出，`license` 取 LICENSE 文件（当前没有，记 `UNSPECIFIED`）。
- **tags-tree 只能是 seq 1**。更新 tags-tree 等于从头生成（第 6 节）。

## 5. CSV 导入

### 格式

表头 `tag,category,aliases,zh,count,notes`，与 ame-la 相同；只有 `tag` 必填，
其他列可以缺省或为空。

| CSV 列     | 写到                 | 说明                                |
| ---------- | -------------------- | ----------------------------------- |
| `tag`      | `name`、`source_key` | 规范化后作为 name                   |
| `category` | `type`               | Danbooru 标签类型 0 / 1 / 3 / 4 / 5 |
| `aliases`  | `tag_alias`          | `\|` 分隔                           |
| `zh`       | `zh`                 |                                     |
| `count`    | `count`              |                                     |
| `notes`    | `notes`              |                                     |

### 规则

1. `name = normalizeTerm(tag)`；已有这个标签就更新，没有就新建。
2. **新建的标签**：`category_path` 为 NULL，`label_*` 为空，`post_count` 为 0，
   **`restricted` 为 0**。
3. **只写 CSV 列**，不改 tags-tree 列；`source_key` 已有时不改。
4. `type`、`zh`、`count`、`notes`：**后导入的覆盖先导入的；CSV
   里是空值时不覆盖**。
5. `aliases`：按 `|`
   拆开，去掉空值；规范化后等于标签名的跳过；同一标签内规范化后重复的只留一个；
   与已有别名合并（不删除）。
6. 每个标签在 `tag_source` 记一行。
7. 同一次导入可以包含多个文件（如 ame-la 的 general / meta / character /
   copyright）， 都用同一个
   `seq`；**导入哪些文件由用户在脚本参数或界面里选择**（例如是否包含
   `artist.csv`）。同一次导入里文件名不能重复。
8. 来源信息（`name`、`repository`、`revision`、`license`、`data_version`）可以在导入时用参数指定；
   不指定时从 CSV 所在的 git
   仓库读取（remote、commit、是否有未提交修改、仓库根目录的 LICENSE）， `name`
   默认为仓库根目录名（不是 git 仓库时用 CSV 所在文件夹名），`data_version`
   留空。
9. `category`、`count` 无效的单元格忽略并提醒，`tag`
   为空的行跳过；不认识的列忽略并提醒。 表头里没有 `tag` 列时中止。
10. 在词库副本上写，全部成功后再替换；任何一步出错，原词库不变。
    词库不存在、不是 v4、没有 tags-tree 的导入记录时中止。

## 6. 生成、重建与替换

- **导入记录**：每次导入按顺序写进
  `import_log`，记下来源、版本和文件哈希，用来查看词库是怎么来的。
- **不做按记录重建**。要撤销某个 CSV、换新版 CSV 或更新 tags-tree：重新导入
  tags-tree（会清空所有 CSV 导入），再按需要重新导入 CSV。
- 已知取舍（以 tags-tree 为主，可以接受）：单纯覆盖导入不能撤销；新版 CSV
  删掉的标签或别名会残留；结果与导入顺序有关。
- **替换**：先写到临时副本，完成后再替换 `tag_catalog.sqlite`；TagLoom
  把词库读进内存后就关闭文件。命令行导入后要重启服务，词库页导入会自动重新加载。

## 7. 隐私

数据库会被分享，**库里不保存任何本机路径**：

- `import_log.path`：tags-tree 存仓库内相对路径；CSV
  命令行导入存文件名，词库页导入存相对所选目录的路径。写入前检查：以 `/`、`\`、
  盘符（如 `C:`）开头或含 `..` 的直接报错。
- `import_log.repository`：git remote 带账号信息（`https://user:token@…`）时去掉
  `user:token@`；remote 是本机路径时存空字符串；CSV 只存用户手填的值。
- 导入过程中出现的本机路径只显示在命令行，不写进任何表。

## 8. 生成时的校验

- **代码用到的分类路径必须存在**：`share/fields.ts`、`share/tag-targets.ts`
  里的每个分类路径都要在 `category` 里，否则**中止生成**（防止 tags-tree
  改名后字段选词悄悄变空）。
- 每个分类的所有上级路径都在 `category` 里。
- 报告数量：分类数（当前 927）、标签数（22,372）、受限标签数（1,264）、频次 CSV
  行数。
- 只提醒、不中止：没有 multilingual
  名称的分类或标签（当前都没有；分类英文名用路径最后一段， 标签名称留空）、频次
  CSV 里没有的标签（当前 2 个：`;"|`、`\//`，频次记为
  0）、重复的标签（保留第一个）。
- 分类名为空或含 `.` 时中止。
- 不要假定「标签只挂在叶子分类上」：这只是当前 YAML 的情况。

## 9. 读取（TagLoom）

### 显示规则

在读取代码里决定，改规则不用重建数据库：

| 信息   | 规则                                                                 |
| ------ | -------------------------------------------------------------------- |
| 中文名 | 优先 `label_zh`，为空时用 `zh`；两者不同时 `zh` 作为可搜索的其他名称 |
| 频次   | 优先 `count`，为空时用 `post_count`（可调整）                        |
| 分类   | 只看 `category_path`；为 NULL 时显示「未分类」或按 `type` 显示类型   |
| 受限   | 只看 `restricted`                                                    |
| 别名   | `tag_alias` 的全部别名                                               |
| 说明   | `notes`：显示在详情、悬停提示里；只在全库检索里参与搜索（见下）      |

### 没有分类的标签

只来自 CSV 的标签（`category_path` 为 NULL）：

- 能搜到：全局搜索、分类添加框的「其他分类」、场景搜索、标签筛选都查全库。
- 能核对：图片导入、agent 接口按 name 和别名精确匹配。
- 不出现在字段选词面板里，全局搜索后也不会自动建议放进哪一栏。

### 检索索引在内存里

`infra/sqlite-catalog.ts`
打开词库时把全部数据读进内存、建好索引后就关闭文件；之后的查询都在内存里完成。
不存进库里，是因为那样库会大很多（v3 词库 139 MB 里 95% 以上是索引），每次导入 CSV
也都要同步更新。

- 用户版本（`PRAGMA user_version`）不是 4 时拒绝打开，提示用导入工具重新生成。
- 受限标签在未开放（`TAGLOOM_ALLOW_RESTRICTED`
  未设）时加载时就跳过，检索、核对、浏览、详情都看不到。
- 库里没有规范化后的写法：索引都用 `normalizeTerm` 生成，输入也先规范化。
- 检索沿用 v3 词库的规则：词项前缀（canonical / 三语名称 /
  别名）、词前缀（按字段加权，代替原来的 FTS5 bm25；权重 名称 12、别名
  6、三语名称 4、分类名 1）、中日文包含（二元组索引找候选）。
  词前缀那一层的排序和 v3 不完全相同。
- 标签筛选（自然语言）沿用 `infra/text-match.ts`，第一次用到时建索引。
- 分类名按分类建索引：检索词命中分类名时，这个分类（含后代）的标签算部分匹配（中日文包含每个分类最多取
  100 个）。不给每个标签复制整条分类链，否则内存要翻倍。
- 说明（`notes`）：只用于全库检索（`search`），核对和标签筛选不用。说明里包含输入的每个词（拉丁文词至少
  2 个字符）就算命中，逐条扫描、不建索引（7.5 万条约 5
  毫秒）；排在所有其他命中之后，名称等已命中的标签不重复算； 最多取频次最高的
  200 个。结果带 `byNote: true`，界面显示说明并加粗命中的词。
- 实测（tags-tree + ame-la 不含画师，74,608 个可显示标签、52,920 条别名、75,069
  条说明）：加载约 2 秒，堆内存约 167 MB；第一次用标签筛选时再多约 66
  MB；一次检索几毫秒到十几毫秒。

### 以后可以加

- 按 `type` 浏览没有分类的标签（「未分类 ·
  元标签」等）。只影响标签筛选页的标签详情和 agent 的分类浏览接口；`type`
  列已经在库里，加的时候只改读取代码和界面。

## 10. 导入工具（`packages/tagloom/catalog-import/`）

| 文件             | 内容                                    |
| ---------------- | --------------------------------------- |
| `cli.ts`         | 命令行入口                              |
| `schema.ts`      | v4 建表语句                             |
| `tags-tree.ts`   | 读取、解析 tags-tree 仓库，准备导入记录 |
| `csv.ts`         | 解析 CSV、写进已有词库                  |
| `write.ts`       | 从头写词库（先写 `.tmp`，成功后替换）   |
| `source-info.ts` | git 信息、LICENSE、文件哈希、导入记录   |
| `privacy.ts`     | 路径和仓库地址的隐私处理                |
| `run.ts`         | 完整的导入流程（命令行和词库页共用）    |
| `detect.ts`      | 检测来源目录的格式（词库页用）          |
| `source-dir.ts`  | 数据源目录里的路径解析、子目录列表      |

在项目根目录（有 `deno.json` 的目录）运行。源数据放在
`data/data_source/`（不提交）：

```bash
# 1. 从 tags-tree 从头生成
deno task tagloom-catalog tree --repo data/data_source/danbooru-tags-tree

# 2. 导入 ame-la：整个文件夹，去掉画师
deno task tagloom-catalog csv --dir data/data_source/danbooru-tags-data-zh/tags --exclude artist.csv --data-version 2026-08
# 或者逐个列出文件
deno task tagloom-catalog csv data/data_source/danbooru-tags-data-zh/tags/meta.csv --name ame-la
```

- `tree`：从头生成，默认输出
  `data/tagloom/tag_catalog.sqlite`，已存在时直接替换。
- `csv`：写进已有词库（默认同上，`--db` 可改）。选项
  `--name`、`--repository`、`--revision`、 `--license`、`--data-version`
  覆盖自动读到的来源信息；`--repository` 只接受网址。
- 用命令行导入后要重启服务；在词库页导入会自动重新加载。
- `tree` 替换旧词库时，旧词库里的 CSV 导入一起清空，会提醒。
- 任务权限：读任意位置、只写 `data/tagloom/`、只能运行
  `git`。输出到别处需要自己改权限运行。
- 没有 git 或不是 git 仓库（zip）时，`repository` / `revision`
  留空，靠文件哈希识别。
- YAML 按 failsafe 读取（所有值都是字符串），`true`、`100`
  这类标签不会被改成布尔或数字。

## 11. 词库导入页（导航「词库导入」，`/tagloom/catalog`）

页面显示当前词库（标签数、版本）和导入记录（按次序分组，可展开看每个文件的哈希和行数）；「数据来源」列出支持的仓库链接和下载命令（`client/pages/CatalogAdmin.tsx` 的 `SOURCES`），
下面选目录导入。接口在
`/api/tagloom/catalog/admin/*`（`server/catalog-admin.ts`）。

### 选目录

- 只能选数据源目录（默认 `data/data_source/`，配置
  `sourceDir`）里的目录，嵌套多深都可以。
- 页面只传相对数据源目录的路径；绝对路径、盘符、`.`、`..`
  一律拒绝，软链接解析后的真实位置
  也必须在数据源目录里。返回给页面的路径都是相对的，出错信息里的本机路径换成相对写法。

### 检测（`detect.ts`）

| 格式      | 依据                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| tags-tree | 所选目录下 `data/source/` 的三个文件（分类树、多语言、频次）都在。只有一部分时列出缺的；选到仓库里的 `data/source` 时提示改选仓库根目录 |
| 标签 CSV  | 所选目录及子目录里的 `.csv`（跳过 `.` 开头、`node_modules`，不进软链接），UTF-8，表头有 `tag` 列                                        |

CSV 每个文件完整解析一遍，给出行数和提醒（与导入时相同）：

| 表头                                   | 标记       | 默认勾选                |
| -------------------------------------- | ---------- | ----------------------- |
| 只有已知列，且除了 `tag` 还有至少一列  | 完全符合   | 是（`artist.csv` 除外） |
| 有 `tag`，另有不认识的列（导入时忽略） | 部分符合   | 否                      |
| 只有 `tag`（只会新建词库里没有的标签） | 只有标签名 | 否                      |
| 没有 `tag` 列 / 不是 UTF-8 / 格式错误  | 不能导入   | 不能勾                  |

- 扫描时遇到的 tags-tree 仓库里那三个文件（频次文件的表头是 `tag,count`）不算
  CSV 来源。
- 一个目录两种格式都有时，由用户选导入方式。
- 每个 CSV 标出所在的 git
  仓库；勾选的文件来自不同仓库时提醒「导入记录只能记一个来源」。
- 来源信息取所选目录所在的 git
  仓库；仓库根目录不在数据源目录里时（数据源文件夹本身不是仓库，
  外层是项目仓库）不采用，当作没有 git
  信息。来源名默认是仓库（或目录）的文件夹名，可以改。

### 导入

- 服务端按同样的规则重新检测，不信任页面传来的结果。
- tags-tree：从头重新生成。词库里已有 CSV 导入时，必须勾选确认「会清空已导入的
  CSV」。
- CSV：只导入勾选的文件，导入记录里的路径是相对所选目录的路径（如
  `tags/general.csv`）。
- 同一时间只允许一个导入，第二个返回 409。
- 成功后重新打开词库，替换正在用的检索服务，不用重启。重新加载（约 2
  秒）和导入本身都是同步的，
  这期间服务端其他请求会等待。新词库打不开时继续用原来的，页面显示原因。
- 生产启动（`start`）需要 `--allow-run=git`
  才能读到版本信息；没有时照常导入，版本留空。
