export type Theme = 'light' | 'dark'
export const THEME_STORAGE_KEY = 'image-workbench-theme'

export function resolveTheme(saved: unknown, systemDark: boolean): Theme {
  return saved === 'light' || saved === 'dark'
    ? saved
    : systemDark
    ? 'dark'
    : 'light'
}

export function preferredTheme(): Theme {
  let saved: unknown
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    // 禁用存储 / 隐私模式仍可切换，首次打开使用系统偏好。
  }
  return resolveTheme(
    saved,
    globalThis.matchMedia('(prefers-color-scheme: dark)').matches,
  )
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function currentTheme(): Theme {
  const theme = document.documentElement.dataset.theme
  return theme === 'dark' || theme === 'light' ? theme : preferredTheme()
}

export function selectTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // 存储不可用时，当前页面的切换仍然有效。
  }
}
