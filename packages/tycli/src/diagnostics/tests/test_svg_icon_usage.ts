import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const fontLigatureIcon = /\sicon="[a-z0-9_]+"/g

const listVueFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
        return await listVueFiles(join(directory, entry.name))
      }
      return entry.isFile() && entry.name.endsWith('.vue') ? [join(directory, entry.name)] : []
    }),
  )
  return nested.flat()
}

export const testVueTemplatesUseSvgIcons = async () => {
  const files = (
    await Promise.all(
      ['src', 'packages'].map((directory) => listVueFiles(join(frontendRoot, directory))),
    )
  ).flat()
  if (files.length === 0) throw new Error('No Vue components were found to inspect.')

  const violations: string[] = []
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(fontLigatureIcon)) {
      violations.push(`${relative(frontendRoot, file)}: ${match[0].trim()}`)
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Vue templates must pass imported SVG icons instead of font-ligature names:\n${violations.join('\n')}`,
    )
  }
  return { success: true, inspectedFiles: files.length }
}

testVueTemplatesUseSvgIcons.description =
  'Vue templates pass imported SVG icon definitions instead of font-ligature icon names.'
