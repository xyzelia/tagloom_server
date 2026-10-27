import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import devServer from '@hono/vite-dev-server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Vite 不认识 Deno workspace：读根 deno.json 的 workspace 和各包 exports，
// 生成 @app/xxx、@app/xxx/sub → 源码文件的精确映射
function workspaceAliases() {
  const root = new URL('./', import.meta.url)
  const readJson = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
  const members: string[] = readJson(new URL('deno.json', root)).workspace
  return members.flatMap((dir) => {
    const base = new URL(`${dir}/`, root)
    const { name, exports } = readJson(new URL('deno.json', base))
    const map: Record<string, string> = typeof exports === 'string'
      ? { '.': exports }
      : exports
    return Object.entries(map).map(([sub, file]) => ({
      find: new RegExp(`^${name}${sub === '.' ? '' : sub.slice(1)}$`),
      replacement: fileURLToPath(new URL(file, base)),
    }))
  })
}

export default defineConfig({
  server: { port: 5175 },
  resolve: { alias: workspaceAliases() },
  plugins: [
    react(),
    // 开发时 Hono 作为 Vite 中间件运行：只有 /api 进 Hono，其余交给 Vite
    devServer({
      entry: 'src/server/app.ts',
      exclude: [/^(?!\/api).*/],
    }),
  ],
})
