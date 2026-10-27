// 人物的身份就是它在 data/tagloom/characters/ 下的相对路径（用 / 分隔，如「漫画A/第1卷/艾莉丝.json」）。
// 没有单独的 id：复制文件就是新人物，移动 / 改名就是换了身份（站内移动会把新路径告诉前端）。
// 这里只做纯字符串规则；真正落到磁盘前，infra 还会检查符号链接和 realpath。

const NAME_MAX = 120
// Windows 保留的设备名（不分大小写，带扩展名也不行）
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const BAD_CHARS = /[<>:"/\\|?*\x00-\x1f\x7f]/

// 相对路径：不以 / 开头或结尾，没有空段、. 和 ..，没有反斜杠、冒号和控制字符。'' 表示根目录。
export function isSafeCharacterPath(path: string): boolean {
  return path.length <= 2000 && !/[\\\x00-\x1f\x7f:]/.test(path) &&
    (path === '' ||
      path.split('/').every((p) => p !== '' && p !== '.' && p !== '..'))
}

export const isJsonPath = (path: string) => /\.json$/i.test(path)

// 新建 / 改名时用户给的文件名或文件夹名：Windows 上也必须合法
export function entryNameError(name: string): string | null {
  if (!name.trim()) return '名称不能为空'
  if (name.length > NAME_MAX) return `名称不能超过 ${NAME_MAX} 个字符`
  if (BAD_CHARS.test(name)) return '名称不能包含 < > : " / \\ | ? * 或控制字符'
  if (/[. ]$/.test(name)) return '名称不能以空格或点结尾'
  if (name.startsWith('.')) {
    return '名称不能以点开头（点开头的文件和文件夹会被忽略）'
  }
  if (RESERVED.test(name)) return `「${name}」是 Windows 保留名称`
  return null
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

// 不带 .json 的文件名，列表和标题栏用
export const stemOf = (path: string) => nameOf(path).replace(/\.json$/i, '')

// 由标题生成文件名主干：去掉非法字符，截断，避开保留名；空的用「未命名人物」
export function fileStemFor(title: string): string {
  let stem = title.replace(/[<>:"/\\|?*\x00-\x1f\x7f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/^[. ]+|[. ]+$/g, '')
  if (!stem) stem = '未命名人物'
  if (RESERVED.test(stem)) stem = `_${stem}`
  return stem
}

// 第 n 个候选文件名：艾莉丝.json、艾莉丝 (2).json、艾莉丝 (3).json……
export const numberedName = (stem: string, n: number) =>
  n <= 1 ? `${stem}.json` : `${stem} (${n}).json`

// a 是否是 b 本身或 b 下面的路径（移动文件夹时不能移进自己里面）
export function isSameOrInside(a: string, b: string): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x === y || x.startsWith(`${y}/`)
}
