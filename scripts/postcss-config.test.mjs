import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import browserslist from 'browserslist'
import postcss from 'postcss'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('PostCSS prefixes CSS for the broader browser compatibility targets', async () => {
  const { default: postcssConfig } = await import('../postcss.config.js')
  assert.deepEqual(
    postcssConfig.plugins.map((plugin) => plugin.postcssPlugin),
    ['autoprefixer'],
  )
  assert.ok(packageJson.devDependencies.autoprefixer)
  const css = await postcss(postcssConfig.plugins).process('.test { user-select: none }', {
    from: undefined,
  })
  assert.match(css.css, /-webkit-user-select:\s*none/)
  assert.deepEqual(css.warnings(), [])
})

test('Browserslist targets at least 95% global usage, including recent releases', () => {
  assert.deepEqual(packageJson.browserslist, ['cover 95.5%', 'last 2 versions', 'not dead'])
  const coveredUsage = browserslist.coverage(browserslist(packageJson.browserslist))
  assert.ok(coveredUsage >= 95, `only ${coveredUsage}% of global browser usage is covered`)
})
