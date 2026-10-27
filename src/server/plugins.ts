// 组装点：注册服务端插件，并选择各插件的存储实现（换数据库只改这里）
// 显式列出：生产入口由 Deno 直接运行，没有 import.meta.glob
// 用函数而不是模块级常量：import 本文件没有副作用，由 app.ts 显式调用时才创建插件
import type { ServerPlugin } from '@app/plugin-sdk'
import { tagloomPlugin } from '@app/tagloom/server'

export function createPlugins(): ServerPlugin[] {
  return [
    // 数据目录放在 data/tagloom：人物 JSON 在 characters/，场景在 scenes/；词库默认 tag_catalog.sqlite，可用环境变量改
    tagloomPlugin({
      dataDir: './data/tagloom',
      catalogPath: Deno.env.get('TAGLOOM_CATALOG_PATH') || undefined,
      allowRestricted: Deno.env.get('TAGLOOM_ALLOW_RESTRICTED') === '1',
    }),
  ]
}
