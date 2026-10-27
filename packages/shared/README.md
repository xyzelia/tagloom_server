# @app/shared

跨插件共用的纯函数（不依赖 Deno / DOM / Node，只用
`TextDecoder`）。按子路径导出，新功能加新的子路径，
不要都堆进一个入口。依赖方向：插件 → shared；shared 不 import 任何插件。

| 子路径                      | 内容                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@app/shared/png`           | `readPngText`：读 PNG 的 tEXt / 未压缩 iTXt（按 UTF-8）                                                                                          |
| `@app/shared/novelai`       | `parseNovelaiPng`：NovelAI 图片元数据；`splitPrompt` / `promptCore`：prompt 语法                                                                 |
| `@app/shared/prompt-bundle` | Prompt 包（模块间传递多角色 Prompt + 可选参数的中立格式）与暂存区（`postHandoff` / `pendingHandoffs` / `markHandoffConsumed`，存储由调用方传入） |

加子路径：在 `deno.json` 的 `exports` 里登记。Vite 的别名在启动时从 workspace
生成， 新增包或子路径后要重启开发服务器。
