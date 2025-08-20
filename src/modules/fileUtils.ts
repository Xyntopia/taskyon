import { zipSync } from 'fflate'

export async function filesToZip(files: File[], name: string): Promise<File> {
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) entries[f.name] = new Uint8Array(await f.arrayBuffer())
  const zipped = zipSync(entries, { level: 6 }) // balanced speed/ratio
  return new File([zipped], name, { type: 'application/zip' })
}
