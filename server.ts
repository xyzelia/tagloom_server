// 生产入口：一个进程同时提供 API 和 vite build 产物
import { Hono } from 'hono'
import { serveStatic } from 'hono/deno'
import api from './src/server/app.ts'
import { closeTagloomRuntime } from '@app/tagloom/server'

const app = new Hono()
app.route('/', api)
app.use('/*', serveStatic({ root: './dist' }))
// SPA 回退：未命中的路径都交给前端路由
app.get('*', serveStatic({ path: './dist/index.html' }))

const server = Deno.serve(
  { port: Number(Deno.env.get('PORT') ?? 5175) },
  app.fetch,
)

// 退出时关闭词库，再结束进程
Deno.addSignalListener('SIGINT', async () => {
  await server.shutdown()
  closeTagloomRuntime()
  Deno.exit(0)
})
