import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const createBuildMetadataDocument = (commit, publishDate) => {
  if (!commit?.trim() || !publishDate?.trim()) {
    throw new Error('COMMIT_HASH and PUBLISH_DATE are required')
  }
  return `${JSON.stringify({ commit: commit.trim(), publishDate: publishDate.trim() })}\n`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [outputPath, commit, publishDate] = process.argv.slice(2)
  if (!outputPath) throw new Error('Usage: write-build-metadata.mjs OUTPUT COMMIT DATE')
  await writeFile(outputPath, createBuildMetadataDocument(commit, publishDate), 'utf8')
}
