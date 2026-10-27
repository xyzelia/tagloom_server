// 插件内导航：各页面共用（在 routes.tsx 里渲染在所有页面之上）。链接是插件内的相对路径。
// 不吸顶：编辑页自己的操作栏吸顶（top: 0），导航跟着页面滚走，不和它抢位置。
import { Link, useLocation } from 'wouter'

const ITEMS = [
  {
    href: '/',
    label: '人物',
    match: (l: string) =>
      l === '/' || l.startsWith('/edit') || l.startsWith('/files'),
  },
  {
    href: '/scenes',
    label: '场景',
    match: (l: string) => l.startsWith('/scenes'),
  },
  {
    href: '/match',
    label: '标签筛选',
    match: (l: string) => l.startsWith('/match'),
  },
  {
    href: '/catalog',
    label: '词库导入',
    match: (l: string) => l.startsWith('/catalog'),
  },
]

export function PluginNav() {
  const [location] = useLocation()
  return (
    <nav className='tabs is-boxed mb-4' aria-label='TagLoom'>
      <ul>
        {ITEMS.map((item) => {
          const active = item.match(location)
          return (
            <li key={item.href} className={active ? 'is-active' : ''}>
              <Link href={item.href} aria-current={active ? 'page' : undefined}>
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
