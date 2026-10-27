# TagLoom 服务

TagLoom：标签管理与 Prompt 组合（人物、场景、标签筛选、标签词库）。
Deno 2 + Vite + React + Hono，开发和生产都是单进程、单端口。

功能介绍和配置见 [packages/tagloom/doc/README.md](packages/tagloom/doc/README.md)。

## 需要

- [Deno](https://deno.com/) 2.x（在 2.9 上测试过）
- git：可选。导入词库时用来记录来源仓库的版本；没有时照常导入，版本留空

## 运行

```sh
deno install        # 安装依赖（生成 node_modules）
deno task build     # 构建前端到 dist/
deno task start     # 生产：http://localhost:5175（PORT 环境变量可改）
```

打开 `http://localhost:5175/tagloom`。

开发时用 `deno task dev`（http://localhost:5175，前端热更新）。

可选的环境变量见 `.env.example`：复制为 `.env` 后修改；没有 `.env` 时只打印一条警告，全部用默认值。

## 准备标签词库

没有词库时 TagLoom 照常可用，只是不做词库核查、搜不到标签。生成词库：

1. 把来源放进 `data/data_source/`（第一次打开「词库导入」页时会自动建这个目录）：

   ```sh
   git clone https://github.com/Jannchie/danbooru-tags-tree data/data_source/danbooru-tags-tree
   git clone https://huggingface.co/datasets/ame-la/danbooru-tags-data-zh data/data_source/danbooru-tags-data-zh
   ```

   第一个是分类树（必需），第二个是中文名、别名、说明等附加信息（可选）。

2. 打开 TagLoom 顶部的「词库导入」页（页面上也列着这两个仓库的链接）：
   - 选 `danbooru-tags-tree` → 检测 → 生成词库；
   - 再选 `danbooru-tags-data-zh` → 检测 → 勾选文件（画师 `artist.csv` 默认不勾）→ 导入。

   导入完成后自动生效，不用重启。

也可以用命令行导入（导入后要重启服务）：

```sh
deno task tagloom-catalog tree --repo data/data_source/danbooru-tags-tree
deno task tagloom-catalog csv --dir data/data_source/danbooru-tags-data-zh/tags --exclude artist.csv --name ame-la
```

两个来源的许可以各自仓库为准。

## 数据

所有运行时数据都在 `data/` 下（不要提交）：

| 路径                              | 内容                                         |
| --------------------------------- | -------------------------------------------- |
| `data/tagloom/characters/`        | 人物 JSON（可以有子文件夹）                  |
| `data/tagloom/scenes/`            | 场景 JSON                                    |
| `data/tagloom/tag_catalog.sqlite` | 标签词库（可重新生成，不含用户资料）         |
| `data/data_source/`               | 词库的来源项目，词库页只能从这里选           |

## 其他命令

```sh
deno task check            # 类型检查
deno task test             # 测试（需要真实词库的测试在没有词库时跳过）
deno task tagloom-agent    # 给 AI 用的命令行工具，见 packages/tagloom/ai-tools/README.md
```

## 安全

接口都**不鉴权**，只适合本机或可信内网。部署到不可信网络前必须加鉴权。

## 结构

```
packages/tagloom/      TagLoom 插件（前后端、词库导入、文档）
packages/shared/       共用的纯函数（读 NovelAI 图片元数据、Prompt 包格式）
packages/plugin-sdk/   插件与宿主的约定（只有类型）
src/                   宿主：挂载插件、首页、布局、文档页面
server.ts              生产入口：API + dist 静态文件
vite.config.ts         开发服务与构建配置
```
