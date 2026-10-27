// client：插件的前端。对 server 只 import type，不 import core；共用代码来自 ../share。
import { lazy } from 'react'
import type { ClientPlugin } from '@app/plugin-sdk'

export default {
  name: 'tagloom',
  base: '/tagloom',
  nav: { label: 'TagLoom' },
  Routes: lazy(() => import('./routes.tsx')),
} satisfies ClientPlugin
