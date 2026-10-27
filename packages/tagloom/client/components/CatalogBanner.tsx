// 词库状态：不可用时明确提示「未进行数据库核查」，手动编辑、保存、导出不受影响
import { useQuery } from '@tanstack/react-query'
import { api, keys, parseResponse } from '../api.ts'

export function useCatalogStatus() {
  return useQuery({
    queryKey: keys.status,
    queryFn: () => parseResponse(api.catalog.status.$get()),
    staleTime: Infinity,
  })
}

export function CatalogBanner() {
  const { data } = useCatalogStatus()
  if (!data) return null
  if (data.available) {
    return (
      <p className='is-size-7 has-text-grey mb-3'>
        词库 {data.version} · {data.tagCount.toLocaleString()} 个标签 · 来源
        {' '}
        {data.sources.map((s) => s.name).join('、')}
        。频次是来源图库的使用次数，不代表成图效果。
      </p>
    )
  }
  return (
    <div className='notification is-warning is-light' role='status'>
      <strong>未进行数据库核查：</strong>
      {data.reason}。仍可手动编辑、保存和导出；选词与候选检索暂不可用。
    </div>
  )
}
