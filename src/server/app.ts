import { Hono } from 'hono'
import { hello } from './routes/hello.ts'
import { createDocsApi } from './docs.ts'
import { createPlugins } from './plugins.ts'

const app = new Hono().basePath('/api')
// 只创建一次：插件创建时会初始化运行时（数据库、worker）
const plugins = createPlugins()

// 宿主自己的路由；.route() 必须链式写，类型才能进 AppType
const routes = app
  .route('/hello', hello)
  // 各插件 docsDir 里的文档
  .route('/doc', createDocsApi(plugins))

// 插件挂到 /api/<name>；插件的 RPC 类型由各插件自己导出，不经过 AppType
for (const p of plugins) app.route(`/${p.name}`, p.api)

export type AppType = typeof routes
export default app
