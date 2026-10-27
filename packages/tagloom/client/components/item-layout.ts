// 条目列表的排列方式（本机偏好，存在 localStorage）：紧凑 = 一行放多条（条目都比较短时省地方），列表 = 一行一条。
// 页面上所有条目列表共用一个设置，切换后同页其他列表、其他标签页一起变。
import { useSyncExternalStore } from 'react'

export type ItemLayout = 'chips' | 'list'

const KEY = 'tagloom.promptItemLayout'
const EVENT = 'tagloom-item-layout'
const DEFAULT: ItemLayout = 'chips'

function read(): ItemLayout {
  try {
    const v = globalThis.localStorage?.getItem(KEY)
    return v === 'list' || v === 'chips' ? v : DEFAULT
  } catch {
    return DEFAULT
  }
}

export function setItemLayout(v: ItemLayout) {
  try {
    globalThis.localStorage?.setItem(KEY, v)
  } catch {
    // 存不了就只在这次生效
  }
  current = v
  globalThis.dispatchEvent?.(new Event(EVENT))
}

let current: ItemLayout | null = null

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) {
      current = read()
      cb()
    }
  }
  globalThis.addEventListener('storage', onStorage)
  globalThis.addEventListener(EVENT, cb)
  return () => {
    globalThis.removeEventListener('storage', onStorage)
    globalThis.removeEventListener(EVENT, cb)
  }
}

export function useItemLayout(): ItemLayout {
  return useSyncExternalStore(
    subscribe,
    () => (current ??= read()),
    () => DEFAULT,
  )
}
