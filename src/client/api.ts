import { hc, parseResponse } from 'hono/client'
import { QueryClient } from '@tanstack/react-query'
import type { AppType } from '../server/app.ts'

// 同源请求；类型直接来自服务端路由定义
export const client = hc<AppType>('/')

// parseResponse：非 2xx 抛错（交给 TanStack Query 的 error），成功时返回成功响应的类型
export { parseResponse }

export const queryClient = new QueryClient()
