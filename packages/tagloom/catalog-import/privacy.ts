// 写进词库的路径和地址不能带出本机信息（词库会被分享）：路径只能是相对路径或文件名，
// 仓库地址去掉账号信息，本机路径不记录。见 doc/CATALOG_DB.md 第 7 节。

// 以 / \ 或盘符开头、含 .. 的路径一律拒绝
export function assertRelativePath(path: string): string {
  const p = path.replaceAll('\\', '/')
  if (
    !p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) ||
    p.split('/').includes('..')
  ) {
    throw new Error(`导入记录只能写相对路径或文件名：${path}`)
  }
  return p
}

// git remote 地址：URL 去掉用户名和密码（token）；scp 写法（git@host:path）原样保留；
// file:// 和本机路径返回空字符串
export function sanitizeRepository(remote: string): string {
  const raw = remote.trim()
  if (!raw) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return ''
    }
    if (url.protocol === 'file:') return ''
    url.username = ''
    url.password = ''
    return url.toString()
  }
  if (/^[\w.-]+@[\w.-]+:(?![\\/])/.test(raw)) return raw
  return ''
}
