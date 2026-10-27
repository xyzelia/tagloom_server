import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, Route, Switch, useLocation } from 'wouter'
import { routes } from './routes.tsx'
import { plugins } from './plugins.ts'
import { ThemeSwitch } from './components/ThemeSwitch.tsx'

// 布局归宿主：titlebar / 导航对所有页面（含插件）生效，插件只渲染内容区
export function App() {
  const [location] = useLocation()
  // 窄屏时导航折叠到汉堡按钮里（Bulma 只有样式，开关状态自己管）
  const [menuOpen, setMenuOpen] = useState(false)
  // 换页后关闭菜单，并把焦点移到内容区（读屏和键盘用户从正文开始）；首次打开页面时不动焦点
  const firstRender = useRef(true)
  useEffect(() => {
    setMenuOpen(false)
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [location])
  const isActive = (base: string) =>
    base === '/'
      ? location === '/'
      : location === base || location.startsWith(`${base}/`)
  // is-tab：选中项用下划线标示（默认的选中背景和文字对比度不够）
  const navItem = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      className={`navbar-item is-tab${isActive(href) ? ' is-active' : ''}`}
      aria-current={isActive(href) ? 'page' : undefined}
    >
      {label}
    </Link>
  )

  return (
    <>
      <a className='skip-link' href='#main'>跳到正文</a>
      <nav className='navbar has-shadow' aria-label='主导航'>
        <div className='navbar-brand'>
          <Link href='/tagloom' className='navbar-item has-text-weight-bold'>
            TagLoom
          </Link>
          {/* 窄屏：放在汉堡按钮左边，不用展开菜单就能切换 */}
          <ThemeSwitch className='is-hidden-desktop' />
          <button
            type='button'
            className={`navbar-burger${menuOpen ? ' is-active' : ''}`}
            aria-label={menuOpen ? '收起菜单' : '展开菜单'}
            aria-expanded={menuOpen}
            aria-controls='main-menu'
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span aria-hidden='true' />
            <span aria-hidden='true' />
            <span aria-hidden='true' />
            <span aria-hidden='true' />
          </button>
        </div>
        <div
          id='main-menu'
          className={`navbar-menu${menuOpen ? ' is-active' : ''}`}
        >
          <div className='navbar-start'>
            {plugins.filter((p) => p.nav).map((p) =>
              navItem(p.base, p.nav!.label)
            )}
            {/* 文档是独立的静态页（public/doc-view.html），整页打开 */}
            <a className='navbar-item is-tab' href='/doc-view.html'>文档</a>
          </div>
          <div className='navbar-end is-hidden-touch'>
            <ThemeSwitch className='navbar-item' />
          </div>
        </div>
      </nav>
      {/* 内容铺满宽度，两侧留 16px，上下留白比默认 section 小 */}
      <main id='main' tabIndex={-1} className='section py-5 px-4'>
        <div className='container is-fluid px-0'>
          <Suspense
            fallback={
              <progress
                className='progress is-small is-primary'
                aria-label='加载中'
              />
            }
          >
            <Switch>
              {routes.map((r) => (
                <Route key={r.path} path={r.path} component={r.component} />
              ))}
              {plugins.map((p) => (
                <Route key={p.name} path={p.base} nest>
                  <p.Routes />
                </Route>
              ))}
              <Route>
                <NotFound />
              </Route>
            </Switch>
          </Suspense>
        </div>
      </main>
    </>
  )
}

function NotFound() {
  useEffect(() => {
    document.title = '页面不存在 · TagLoom'
  }, [])
  return (
    <div className='has-text-centered py-6'>
      <p className='title is-4'>页面不存在</p>
      <p className='subtitle is-6 has-text-grey'>链接可能已失效或输入有误。</p>
      <Link href='/tagloom' className='button'>返回 TagLoom</Link>
    </div>
  )
}
