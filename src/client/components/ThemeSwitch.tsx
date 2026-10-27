import { useEffect, useSyncExternalStore } from 'react'
import {
  applyTheme,
  currentTheme,
  preferredTheme,
  selectTheme,
  type Theme,
  THEME_STORAGE_KEY,
} from '../theme.ts'

// 导航里可能同时有两个开关（窄屏在汉堡按钮旁、宽屏在最右边），用同一份状态
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const notify = () => listeners.forEach((listener) => listener())

function choose(next: Theme) {
  selectTheme(next)
  notify()
}

// 线条图标（24×24，描边随文字颜色），不用 emoji
function SunIcon() {
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <circle cx='12' cy='12' r='4' />
      <path d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41' />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M20.99 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.78 9.79z' />
    </svg>
  )
}

// 一个图标按钮：显示的是点了之后会切到的模式（亮色时显示月亮）
export function ThemeSwitch(props: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, currentTheme)
  useEffect(() => {
    // 同一站点的其他标签页修改主题时同步；不重新写入存储，避免事件循环。
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
      applyTheme(preferredTheme())
      notify()
    }
    globalThis.addEventListener('storage', onStorage)
    return () => globalThis.removeEventListener('storage', onStorage)
  }, [])
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  const label = next === 'dark' ? '切换到暗色模式' : '切换到亮色模式'
  return (
    <button
      type='button'
      className={`theme-switch${props.className ? ` ${props.className}` : ''}`}
      aria-label={label}
      title={label}
      onClick={() => choose(next)}
    >
      {next === 'dark' ? <MoonIcon /> : <SunIcon />}
    </button>
  )
}
