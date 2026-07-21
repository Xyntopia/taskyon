import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

const listFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? await listFiles(path) : [path]
    }),
  )
  return nested.flat()
}

const routeFiles = await listFiles(join(root, 'src', 'router'))
const routePaths = (
  await Promise.all(
    routeFiles
      .filter((path) => extname(path) === '.ts')
      .map(async (path) =>
        Array.from(
          (await readFile(path, 'utf8')).matchAll(/\bpath:\s*['"]([^'"]+)['"]/g),
          (match) => (match[1]?.startsWith('/') ? match[1] : `/${match[1] ?? ''}`),
        ),
      ),
  )
)
  .flat()
  .filter((path) => path && !path.includes(':catchAll'))

const routeRegexes = routePaths.map((path) => {
  const segments = path.split('/').filter(Boolean)
  const pattern = segments
    .map((segment) => {
      if (!segment.startsWith(':')) {
        return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
      }
      return /[?*]$/.test(segment) ? '(?:/.*)?' : '/.*'
    })
    .join('')
  return new RegExp(`^${pattern || '/'}/?$`, 'i')
})

const sourceFiles = (
  await Promise.all(
    [join(root, 'src'), join(root, 'packages', 'ui')].map(async (path) => await listFiles(path)),
  )
)
  .flat()
  .filter((path) => ['.ts', '.vue'].includes(extname(path)))

const literalPatterns = [
  /\b(?:to|href)=["'](\/[^"'{}]*)["']/g,
  /\b(?:push|replace)\(\s*["'](\/[^"']*)["']/g,
]

const candidates = []
for (const file of sourceFiles) {
  const content = await readFile(file, 'utf8')
  for (const pattern of literalPatterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) candidates.push({ file, href: match[1] })
    }
  }
}

for (const { file, href } of candidates) {
  const path = decodeURIComponent(href.split(/[?#]/)[0] ?? '')
  if (!path || path === '/' || path === '/404') continue
  if (routeRegexes.some((route) => route.test(path))) continue
  try {
    await access(join(root, 'public', path))
  } catch {
    failures.push(`${file.slice(root.length + 1)}: unresolved internal link ${href}.`)
  }
}

if (failures.length > 0) {
  console.error(`Application link check failed with ${failures.length} issue(s):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exitCode = 1
} else {
  console.log(`Application link check passed for ${candidates.length} static link(s).`)
}
