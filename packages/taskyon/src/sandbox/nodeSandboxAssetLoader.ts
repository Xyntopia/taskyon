import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function loadNodeSandboxAsset(
  packageName: string,
  fileName: string,
  expectedHash: string,
): Promise<string> {
  const packageEntry = fileURLToPath(import.meta.resolve(packageName))
  const path = join(dirname(packageEntry), fileName)
  const bytes = await readFile(path)
  const actualHash = createHash('sha256').update(bytes).digest('hex')
  if (actualHash !== expectedHash) {
    throw new Error(`Sandbox asset integrity check failed: ${fileName}`)
  }
  return bytes.toString('base64')
}
