import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { resolveTheme, THEME_STORAGE_KEY } from './theme.ts'

Deno.test('theme preference overrides the system; absent or invalid preferences follow the system', () => {
  for (const dark of [true, false]) {
    assert.equal(resolveTheme('light', dark), 'light')
    assert.equal(resolveTheme('dark', dark), 'dark')
    for (const saved of [null, undefined, 'invalid', '']) {
      assert.equal(resolveTheme(saved, dark), dark ? 'dark' : 'light')
    }
  }
})

Deno.test('pre-paint HTML bootstrap matches runtime theme resolution, even when storage is blocked', async () => {
  const html = await Deno.readTextFile(
    new URL('../../index.html', import.meta.url),
  )
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script)
  for (const dark of [true, false]) {
    for (const saved of ['light', 'dark', null, 'invalid', 'blocked']) {
      const root = {
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
      }
      runInNewContext(script, {
        document: { documentElement: root },
        localStorage: {
          getItem(key: string) {
            assert.equal(key, THEME_STORAGE_KEY)
            if (saved === 'blocked') throw new Error('blocked')
            return saved
          },
        },
        matchMedia: () => ({ matches: dark }),
      })
      assert.equal(
        root.dataset.theme,
        resolveTheme(saved === 'blocked' ? null : saved, dark),
      )
      assert.equal(root.style.colorScheme, root.dataset.theme)
    }
  }
})
