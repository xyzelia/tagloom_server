import assert from 'node:assert/strict'
import { type BracketEdit, bracketEdit } from './bracket-input.ts'

// 把编辑应用到文字上：| 表示光标，«» 表示选区
function apply(value: string, edit: BracketEdit | null) {
  if (!edit) return null
  const v = edit.insert === null
    ? value
    : value.slice(0, edit.from) + edit.insert + value.slice(edit.to)
  return edit.selStart === edit.selEnd
    ? v.slice(0, edit.selStart) + '|' + v.slice(edit.selStart)
    : v.slice(0, edit.selStart) + '«' + v.slice(edit.selStart, edit.selEnd) +
      '»' + v.slice(edit.selEnd)
}
const run = (value: string, start: number, end: number, key: string) =>
  apply(value, bracketEdit(value, start, end, key))

Deno.test('opening bracket wraps the selection and keeps the inner text selected', () => {
  assert.equal(run('rain, city', 0, 4, '('), '(«rain»), city')
  assert.equal(run('rain', 0, 4, '['), '[«rain»]')
  assert.equal(run('rain', 0, 4, '{'), '{«rain»}')
  // 再套一层
  assert.equal(run('(rain)', 1, 5, '('), '((«rain»))')
})

Deno.test('opening bracket without selection auto-closes only before end / space / comma / closer', () => {
  assert.equal(run('', 0, 0, '('), '(|)')
  assert.equal(run('rain, city', 4, 4, '('), 'rain(|), city')
  assert.equal(run('a b', 1, 1, '['), 'a[|] b')
  assert.equal(run('(x)', 2, 2, '('), '(x(|))')
  // 在单词前面：照常输入，不补
  assert.equal(run('rain', 0, 0, '('), null)
})

Deno.test('typing a closer right before the same closer steps over it', () => {
  assert.equal(run('(rain:1.2)', 9, 9, ')'), '(rain:1.2)|')
  assert.equal(run('[x]', 2, 2, ']'), '[x]|')
  assert.equal(run('(x)', 2, 2, ']'), null)
  assert.equal(run('x', 1, 1, ')'), null)
})

Deno.test('backspace inside an empty pair deletes both', () => {
  assert.equal(run('a()', 2, 2, 'Backspace'), 'a|')
  assert.equal(run('{}', 1, 1, 'Backspace'), '|')
  assert.equal(run('(x)', 2, 2, 'Backspace'), null)
  assert.equal(run('(]', 1, 1, 'Backspace'), null)
  assert.equal(run('()', 0, 0, 'Backspace'), null)
})

Deno.test('other keys and selections are left to the browser', () => {
  assert.equal(run('rain', 0, 4, ')'), null)
  assert.equal(run('rain', 0, 4, 'Backspace'), null)
  assert.equal(run('rain', 2, 2, 'a'), null)
})
