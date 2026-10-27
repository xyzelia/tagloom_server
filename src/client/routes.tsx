import { Redirect } from 'wouter'

// 宿主自己的页面；插件页面见 plugins.ts。只有 TagLoom 一个插件，首页直接进 TagLoom
export const routes = [
  { path: '/', component: () => <Redirect to='/tagloom' replace /> },
]
