// 全局样式：只在宿主引入一次，插件页面直接使用 Bulma 类名（见 README「前端样式」）
import 'bulma/css/bulma.min.css'
// 少量补充样式（工具类），必须在 Bulma 之后引入
import './app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.tsx'
import { queryClient } from './api.ts'
import { applyTheme, currentTheme } from './theme.ts'

// 与 HTML 的首屏主题保持一致，也为嵌入或测试时没有引导脚本的情况提供兜底。
applyTheme(currentTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
