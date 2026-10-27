// 整页接收拖入的文件：拖到页面任意位置松开即可，不需要专门的拖放区（做法同 NovelAI 新建任务的导入）。
// 只处理文件，不影响页面里拖动文字和条目排序。返回是否正拖着文件经过页面，按钮据此显示「松开导入」。
import { useEffect, useRef, useState } from 'react'

export function usePageFileDrop(
  onFile: (file: File) => void,
  enabled = true,
): boolean {
  const [over, setOver] = useState(false)
  const latest = useRef({ onFile, enabled })
  latest.current = { onFile, enabled }
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (latest.current.enabled) setOver(true)
    }
    const onLeave = (e: DragEvent) => {
      // 离开浏览器窗口时 relatedTarget 为空
      if (e.relatedTarget === null) setOver(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setOver(false)
      const file = e.dataTransfer?.files[0]
      if (file && latest.current.enabled) latest.current.onFile(file)
    }
    document.addEventListener('dragover', onOver)
    document.addEventListener('dragleave', onLeave)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('dragleave', onLeave)
      document.removeEventListener('drop', onDrop)
    }
  }, [])
  return over
}
