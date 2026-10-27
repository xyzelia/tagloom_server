# 场景组合

> 状态：已实现（2026-10-15）。读者：开发者。

## 1. 定位与边界

场景 = 组合各种 tag 得到一份多角色 Prompt：场景自有条目 + 若干人物槽位。

- **以提示词内容为主**。不存画风串（归 novelai
  模板），人物的画风串只用于记录「该画风下可用」，不带入场景。
- **生成参数可选**（`params`：尺寸、种子、步数、CFG、采样器……），用于复现。
  每项都可留空，留空由生成端决定；tagloom
  只存、原样导出，不校验取值是否被生成端支持。
- **场景不分类**。场景自有内容是一个有序条目列表，来源为全词库搜索、场景自创标签或自由文本。
- **人物数据 = 一次性快照**。导入时把「人物 + 组合 +
  状态」组装成文本存进槽位，之后与人物文件无关；
  人物修改不影响场景，不提供「按人物更新」。要换表情 /
  状态就「重新选择」，整份快照覆盖。
- **数据分离**：人物内容只在 `snapshot` 里，场景对人物的补充写在槽位的
  `extra`，场景自有内容写在 `content`。重新选择只替换
  `snapshot`（分段开关沿用），其余保留。
- tagloom 仍不依赖 novelai：只导出与 novelai 请求结构对应的成品
  JSON，由使用方读取。

## 2. 统一的文件格式标记

tagloom 写出的 JSON 都带 `format` + `formatVersion`，按 `format`
判定文件类型（`share/formats.ts`）：

| `format`               | `formatVersion` | 内容             | 位置 / 来源                |
| ---------------------- | --------------- | ---------------- | -------------------------- |
| `tagloom.character`    | 2               | 人物             | `data/tagloom/characters/` |
| `tagloom.scene`        | 1               | 场景             | `data/tagloom/scenes/`     |
| `tagloom.project`      | 2               | 人物存档 | 导出下载                   |
| `tagloom.output`       | 2               | 人物下游成品     | 导出下载                   |
| `tagloom.scene-output` | 1               | 场景下游成品     | 导出下载                   |

`detectFormat(value)` 只看标记：没有 `format` 的对象按旧人物文件处理；`format`
认识但 `formatVersion` 不对（如未来的 v3）一律 `unknown`。

- 标记**不在** `Character` / `Scene` 类型里：写文件时由 `infra/json-repo.ts`
  加在最前面，读取时 `withoutFormat` 去掉。接口返回的人物 / 场景不带标记。
- **旧人物文件**（无标记）照常读取，不改写磁盘；下次保存时写入标记。
- **人物存档**：内层 `character`
  不带标记（外层已标明）；导入时内层有没有都接受。
- **人物文件浏览**：带人物标记或没有标记的文件都能预览 /
  导入；场景、成品等其他格式只显示原文。
- **回退风险**：新版本保存过的人物文件带了
  `format`，旧版本代码会把它当成「非人物」而不显示。

## 3. 场景数据结构（`share/scene.ts`）

```ts
export const MAX_SCENE_SLOTS = 6 // 对应 NovelAI V4 多角色上限（待核实）

export interface Scene {
  path: string // 身份 = scenes/ 下的相对路径，不写进文件
  version: number // 乐观锁，保存时 +1
  createdAt: number // epoch 毫秒
  updatedAt: number
  title: string
  note: string // 只记录，不进入 Prompt
  content: Segment // 场景自有条目（不分类，条目 field 恒为 null）
  negativePrompt: string // 手写原文
  customTags: CustomTag[] // 场景自创标签库，content 与各槽位 extra 共用
  slots: CharacterSlot[] // 有序，顺序即输出 characters[] 的顺序
  params?: SceneParams // 可选生成参数；没有这个键 = 都不指定
}

// 每项可选；字段名与 novelai RequestForm 一致，导出时原样带出
export interface SceneParams {
  model?: string
  width?: number
  height?: number
  steps?: number
  scale?: number
  cfgRescale?: number
  sampler?: string
  noiseSchedule?: string
  seed?: number
}

export interface CharacterSlot {
  id: string // 槽位身份，重新选择人物 / 状态时不变
  label: string // 如「左边的人」「主角」，可空
  snapshot: SlotSnapshot | null // null = 纯手写人物
  extra: Segment // 场景对此人物的补充，换快照不丢
  position: { x: number; y: number } | null // 0..1；null = 不指定
}

export interface SlotSnapshot {
  // 来源记录：只用于界面显示和「重新选择」时默认定位，不再回读
  characterPath: string
  title: string
  comboId: string
  comboName: string
  stateId: string | null // null = 不使用状态
  stateName: string
  takenAt: number
  // 组装结果（状态 overrides 与组合发型覆盖已应用）
  subject: string
  base: string
  costume: string
  expression: string
  action: string
  negative: string // 人物负面 Prompt
  use: Record<
    'subject' | 'base' | 'costume' | 'expression' | 'action' | 'negative',
    boolean
  >
}
```

### 3.1 约束（`core/schema.ts` 的 `sceneContentSchema`）

- `content` / `extra`：`facts` 必须为空，`fieldStates` 必须为空，条目 `field`
  必须为 `null`； 条目来源可以是 `catalog` / `custom` / `text`，`custom`
  指向本场景的 `customTags`。
- 场景自创标签的 `fields`
  必须为空（不分字段）。规则沿用人物标签库：选用时复制文本，改标签库不静默改变在用条目。
- `slots.length <= MAX_SCENE_SLOTS`；`position` 两个坐标都在 0..1。
- `params`：不认识的键拒绝；范围（`share/scene.ts` 的
  `SCENE_PARAM_LIMITS`，schema、编辑框、图片导入共用）`width` / `height`
  1..16384 整数、`steps` 1..1000 整数、`scale` 0..100、`cfgRescale` 0..1、`seed`
  0..2³²−1 整数，文本项最长 200。 保存时去掉空字符串项，一项都没有就不写
  `params` 键；保存不带 `params` = 清空。
  旧文件没有这个键，不需要迁移（`formatVersion` 不变）。
- 快照文本只读：界面不提供逐条编辑。要改就关掉对应段，在 `extra` 里自己写；
  或「复制以改写」（`snapshotPartToExtra`）把该段文本复制成 `extra`
  的一条文本条目并关掉该段。

### 3.2 快照生成

```ts
buildSlotSnapshot(character, characterPath, comboId, stateId, now): SlotSnapshot | null
```

- 前端选好人物 / 组合 /
  状态后调用（`client/components/CharacterPicker.tsx`），服务端只校验结构。
- 组合不存在返回 null；状态找不到按「不使用状态」。
- `replaceSnapshot(slot, next)`：整份覆盖，`use`
  沿用旧值；空槽位第一次选择时全开。
- 重新选择时默认定位到原人物 / 组合 /
  状态；人物文件不在了就提示另选，现有快照不受影响。

### 3.3 输出（`tagloom.scene-output`）

与 novelai `RequestForm` 的 `prompt` / `negativePrompt` / `characters[]`
及参数字段对应，但不 import novelai：

```ts
export interface SceneOutput {
  format: 'tagloom.scene-output'
  formatVersion: 1
  exportedAt: number
  sourceVersion: number
  title: string
  prompt: string // content 中勾选条目按顺序连接
  negativePrompt: string
  characters: {
    label: string // 槽位名称，空则用快照人物名，再空则「人物 N」
    prompt: string // 快照中开启的段（主体 → Base → 服装 → 表情 → 动作）+ extra
    negativePrompt: string // use.negative ? snapshot.negative : ''
    x: number | null
    y: number | null
  }[]
  params: SceneParams // 只含填了的项；都没填为 {}
}
```

纯文本导出在末尾加 `## Parameters` 段（`键: 值`
每行一项），没填参数时没有这一段。

拼接规则沿用 `assemble.ts`：只去首尾空白和逗号，不去重、不重排、不改写权重。

### 3.4 发送到其他模块（Prompt 包暂存区）

导出菜单「发送到其他模块」把**当前编辑内容**（不要求先保存）用
`buildPromptBundle` 转成 `@app/shared/prompt-bundle` 的 Prompt 包（内容同 3.3 的
prompt / negativePrompt / characters / params），放进 localStorage
暂存区（`postHandoff`，24 小时有效，最多 10 条）。 tagloom
不知道谁会接收；接收方（如 novelai 新建任务页）进页面时自己检测、导入或忽略。
两边只依赖 shared，任何一方不装都不影响另一方。

人物编辑页的导出菜单也有「发送到其他模块」（`buildCharacterBundle`）：主 Prompt 和负面留空，
**当前选中的组合 + 状态**作为唯一一个角色（内容同导入场景时的快照，不指定位置），人物默认种子放进
params.seed。novelai 收到只有角色、没有主 Prompt 的包时默认追加成新角色，带种子时会提示。

接收（`client/components/HandoffBanner.tsx`）：场景列表页和编辑页检测暂存区里没处理过、不是
tagloom 自己发出的条目。

- 列表页「导入为新场景」：在当前文件夹新建场景，内容全部带入（`applySceneImport`
  替换模式、全部分组），然后打开编辑页。
- 编辑页「导入到当前场景」：走和图片导入相同的确认弹窗（追加 /
  替换、按组勾选、查词库）。
- 导入或忽略后记入 `consumedBy`，不再提示。

导入来源统一转成 `SceneImportSource`（`sourceFromNovelaiMeta` /
`sourceFromBundle`），再由 `planSceneImport` 拆条目、查词库。Prompt
包里的人物名称带入槽位名称；位置吸附到 5 × 5 网格；参数超出范围的不导入。

## 4. 存储

- 目录 `data/tagloom/scenes/`，任意层子文件夹；**身份 =
  相对路径**，规则与人物完全一致 （文件名取自标题、重名加
  `(2)`、不覆盖已有文件、点开头忽略、不跟随符号链接、Windows 合法名）。
- 场景判定：`detectFormat(value) === 'scene'`、整数 `version >= 1`、`createdAt`
  / `updatedAt`、通过 schema。
- `infra/json-repo.ts` 的 `createJsonDocRepo`
  是人物和场景共用的文件存储（原子写入、硬链接新建、
  按修改时间缓存摘要）；场景另外缓存全文搜索文本，搜索不必每次读全部文件。

## 5. 接口（`/api/tagloom/scenes/*`）

与人物接口同构，错误体统一 `{ code, message, details? }`；路径一律放查询参数
`path`。

| 方法   | 路径                         | 参数                                      | 说明                                                                  |
| ------ | ---------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| GET    | `/scenes`                    | `?folder=`                                | 逐层列出：`{ folder, folders, scenes, otherFiles }`                   |
| GET    | `/scenes/search`             | `?q=`                                     | 全文：标题、备注、负面、条目、自创标签、槽位名称、快照；空 = 全部     |
| POST   | `/scenes`                    | `{ content?, folder?, path? }`            | 新建 → 201 场景；`path` 已存在 409 `already_exists`                   |
| GET    | `/scenes/item`               | `?path=`                                  | 读取完整场景                                                          |
| PUT    | `/scenes/item`               | `?path=` + `{ expectedVersion, content }` | 保存；版本不符 409 `version_conflict`；文件被移走 404；内容不合法 422 |
| DELETE | `/scenes/item`               | `?path=&expectedVersion=`                 | 删除                                                                  |
| POST   | `/scenes/item/move`          | `?path=` + `{ expectedVersion, to }`      | 移动 / 改名；目标已存在 409                                           |
| POST   | `/scenes/item/copy`          | `?path=` + `{ folder?, path? }`           | 复制为新场景（缺省同文件夹、标题加「副本」）→ 201                     |
| GET    | `/scenes/item/export/output` | `?path=&format=json\|text`                | 下载 `tagloom.scene-output` 或纯文本                                  |
| POST   | `/scenes/folders`            | `{ path }`                                | 新建文件夹                                                            |
| POST   | `/scenes/folders/move`       | `{ path, to }`                            | 移动 / 改名，不能移进自己                                             |
| DELETE | `/scenes/folders`            | `?path=`                                  | 只能删空文件夹                                                        |

复用的现有接口：选人物用
`GET /characters/search`、`GET /characters/item`；选词用
`GET /catalog/search`（只用 `q`、`limit`）。

## 6. 前端

- 页面：`/tagloom/scenes`（`SceneList.tsx`）、`/tagloom/scenes/edit?path=`（`SceneEdit.tsx`）；
  从插件顶部标签页「场景」进入。
- `SceneTagInput.tsx`：场景的添加框，下拉列出场景自创标签和全词库搜索结果（不限分类），
  不选时添加文本条目，「存为自创标签」先加进场景标签库再加入。
- `SlotEditor.tsx`：快照摘要 + 分段开关 + 重新选择 / 移除快照 + 补充条目 + 5 × 5
  位置网格 + 该人物的 Prompt 预览。
- `CharacterPicker.tsx`：选人物 → 组合 → 状态，预览各段后生成快照。
- `SceneParamsEditor.tsx`：可选生成参数，折叠在「生成参数（可选）」里；数值非法时禁止保存
  （同人物种子）。模型、采样器等按原文填写，不引用 novelai 的选项列表。
- `SceneImport.tsx`：从 NovelAI 图片导入：顶部操作栏「从图片导入」按钮，或把图片拖到页面任意位置
  （场景列表上拖入 / 「更多」里选图片会先新建场景，再在编辑页接着导入）。（浏览器里读 PNG
  元数据，`@app/shared/novelai`）。 主 Prompt → 场景条目，角色 →
  新人物槽位（补充条目 + 位置，只在图片开了自定义位置时设置， 吸附到 5 × 5
  网格），负面 → 场景负面 Prompt（角色负面并入，因为槽位没有负面）。
  每条按顶层逗号拆开，去掉权重写法后用 `/agent/catalog/lookup`
  查词库：命中做成词库条目、 文字保留原文（含权重）；查不到 /
  词库不可用做成文本条目。可选追加或替换； Comment
  里的尺寸、种子、步数、CFG、CFG
  Rescale、采样器、噪声调度导入为生成参数（超出范围的不导入；模型只有描述，不导入）：追加时覆盖同名项，替换时整份替换。映射是纯函数
  `share/scene-import.ts`。
- 复用：`PromptItemList`、`CustomTagLibrary`（改为泛型，场景隐藏「适用字段」列）、
  `ListParts.tsx`（从人物列表拆出的面包屑、搜索框、名称对话框、行操作）。

## 7. 暂不做

- 场景分类。
- 人物更新提示 / 按人物更新快照。
- 画风串。
- 从人物标签库复制自创标签到场景。
- AI agent 场景接口（如服务端生成快照）。
- 一键跳转到接收方（需要宿主提供跳转；数据仍走同一个暂存区）。
