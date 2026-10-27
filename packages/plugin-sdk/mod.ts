// @app/plugin-sdk：插件与宿主之间的约定，只有类型。插件只依赖它，不依赖宿主
import type { ComponentType } from 'react'
import type { Hono } from 'hono'

// 服务端插件：宿主挂载到 /api/<name>
export interface ServerPlugin {
  name: string
  // deno-lint-ignore no-explicit-any
  api: Hono<any, any, any>
  // 文档目录（文件系统路径），其中的 .md（可嵌套子目录）由宿主按原路径提供原文：
  // /api/doc/<name>/<路径>（目录返回子目录和 .md 列表）；渲染和文件树在 /doc-view.html?src=…
  docsDir?: string
}

// 前端插件：宿主挂载到 base（wouter nest），插件内部路由写相对路径
export interface ClientPlugin {
  name: string
  base: string
  nav?: { label: string }
  Routes: ComponentType
}
