// 编辑页顶部栏：一次切换页面上所有条目列表的排列方式（紧凑 = 一行多条 / 列表 = 一行一条），只存在这台设备上
import { type ItemLayout, setItemLayout, useItemLayout } from './item-layout.ts'

export function ItemLayoutSwitch() {
  const layout = useItemLayout()
  const opt = (v: ItemLayout, text: string, title: string) => (
    <button
      type='button'
      className={`button${layout === v ? ' is-link is-light is-selected' : ''}`}
      aria-pressed={layout === v}
      title={title}
      onClick={() => setItemLayout(v)}
    >
      {text}
    </button>
  )
  return (
    <span
      className='buttons has-addons mb-0 tagloom-layout-switch'
      role='group'
      aria-label='条目排列方式（所有列表）'
    >
      {opt('chips', '紧凑', '所有条目列表一行放多条，来源用左边框颜色表示')}
      {opt('list', '列表', '所有条目列表一行一条，显示来源')}
    </span>
  )
}
