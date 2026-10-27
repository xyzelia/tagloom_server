// 发送到其他模块：放进 Prompt 包暂存区（@app/shared/prompt-bundle，localStorage）。
// 接收的模块进页面时自己检测，这里不知道谁会接收。人物编辑和场景编辑共用，返回发送函数和结果提示。
import { type ReactNode, useState } from 'react'
import { postHandoff, type PromptBundle } from '@app/shared/prompt-bundle'

export function useHandoffSend(): {
  send: (bundle: PromptBundle) => void
  notice: ReactNode
} {
  const [sent, setSent] = useState<{ ok: boolean; text: string } | null>(null)

  const send = (bundle: PromptBundle) => {
    try {
      postHandoff(localStorage, {
        from: { id: 'tagloom', label: 'TagLoom' },
        bundle,
      }, { id: crypto.randomUUID(), now: Date.now() })
      setSent({
        ok: true,
        text:
          `已把「${bundle.title}」放进暂存区（当前编辑内容，24 小时内有效）。打开接收的页面（如 NovelAI 新建任务）会提示导入。`,
      })
    } catch {
      setSent({ ok: false, text: '浏览器存储不可用，发送失败。' })
    }
  }

  const notice = sent && (
    <div
      className={`notification is-light py-2 px-3 ${
        sent.ok ? 'is-success' : 'is-danger'
      }`}
      role='status'
    >
      <button
        type='button'
        className='delete'
        aria-label='关闭'
        onClick={() => setSent(null)}
      />
      {sent.text}
    </div>
  )

  return { send, notice }
}
