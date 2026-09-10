import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024
const TEXT_EXTENSIONS = [
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.csv',
  '.cts',
  '.graphql',
  '.h',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.lock',
  '.mjs',
  '.md',
  '.mts',
  '.py',
  '.rs',
  '.sass',
  '.scss',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]
const EXCLUDED_DIRECTORIES = [
  '.cache',
  '.git',
  '.quasar',
  '.yarn',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'target',
]

const repositoryFiles = () =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)

const isExcluded = (filename) =>
  filename.split('/').some((part) => EXCLUDED_DIRECTORIES.includes(part))

const isTextFile = (filename) => TEXT_EXTENSIONS.includes(path.extname(filename).toLowerCase())

const sizeOf = (filename) => {
  try {
    const file = statSync(filename)
    return file.isFile() ? file.size : null
  } catch {
    return null
  }
}

const findOversizedFiles = (root) =>
  repositoryFiles()
    .filter((filename) => !isExcluded(filename) && isTextFile(filename))
    .map((filename) => ({ filename, bytes: sizeOf(path.resolve(root, filename)) }))
    .filter((file) => file.bytes !== null && file.bytes > MAX_BYTES)
    .sort((a, b) => b.bytes - a.bytes)

const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`

const oversized = findOversizedFiles(process.cwd())
if (oversized.length > 0) {
  console.error(
    `File size check failed: ${oversized.length} file(s) exceed ${formatBytes(MAX_BYTES)}.`,
  )
  for (const file of oversized)
    console.error(`- ${file.filename}: ${formatBytes(file.bytes)} (${file.bytes} bytes)`)
  process.exitCode = 1
} else {
  console.log(`File size check passed: no checked text file exceeds ${formatBytes(MAX_BYTES)}.`)
}
