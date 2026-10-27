// 前端插件注册表：与 src/server/plugins.ts 对应，新增插件在这里加一行
import type { ClientPlugin } from '@app/plugin-sdk'
import tagloom from '@app/tagloom/client'

export const plugins: ClientPlugin[] = [tagloom]
