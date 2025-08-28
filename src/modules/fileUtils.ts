// fileUtils.ts
import { chunk } from 'src/modules/utils'
import type { AskSession } from './@taskyon/taskyon'
import {
  decryptDataFile,
  encryptDataFile,
  EncryptedDataRowMixed,
  type EncryptedDataRow,
} from './@taskyon/taskyon'
import { deflateSync, inflateSync, zipSync } from 'fflate'
import { decode, encode } from '@msgpack/msgpack'

export function compressObjects(objs: unknown): Uint8Array {
  const jsonStr = JSON.stringify(objs)
  const data = new TextEncoder().encode(jsonStr)

  // using messagepack consistently gives us slightly larger files than JSON.stringify
  // probably because of repeated keys...
  // Option B: MessagePack (skip JSON.stringify)
  // const data = msgpack.encode(objs)

  return deflateSync(data)
}

export async function encryptCompressObject(
  objs: Record<string, unknown>,
  info: string,
  recoveryKey: AskSession,
  sessionKey: AskSession,
) {
  const compressed = compressObjects(objs)
  const encrypted = await encryptDataFile(compressed, info, recoveryKey, sessionKey, false)
  const packed = encode(encrypted)
  return packed
}

export async function decompressEncryptedObject(
  buffer: Uint8Array,
  info: string,
  sessionKey: AskSession,
) {
  const encrypted = EncryptedDataRowMixed.parse(decode(buffer))
  const decrypted = await decryptDataFile(encrypted, info, sessionKey)
  const decompressed = uncompressObjects(decrypted) as Record<string, unknown>
  return decompressed
}

export function uncompressObjects(data: Uint8Array): unknown {
  const jsonStr = new TextDecoder().decode(inflateSync(data))

  // if you were using msgpack: return msgpack.decode(inflateSync(data)) as unknown[]
  return JSON.parse(jsonStr)
}

export async function filesToZip(files: File[], name: string): Promise<File> {
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) entries[f.name] = new Uint8Array(await f.arrayBuffer())
  const zipped = zipSync(entries, { level: 6 }) // balanced speed/ratio
  return new File([zipped], name, { type: 'application/zip' })
}

export async function createZipFiles(
  files: File[],
  zipBaseName: string,
  max_files_per_chunk = 60, // 30 app + 30 public properties
): Promise<{ zipFile: File; filenames: string[] }[]> {
  if (!files.length) throw new Error('createZipFiles: no files provided')

  const parts = chunk(files, max_files_per_chunk)
  const results = []

  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx]!
    const zipName = parts.length === 1 ? `${zipBaseName}.zip` : `${zipBaseName}.${idx + 1}.zip`

    const zipBlob = await filesToZip(part, zipName)
    const zipFile = new File([zipBlob], zipName, { type: 'application/zip' })

    results.push({
      zipFile,
      filenames: part.map((f) => f.name),
    })
  }

  return results
}

export function saveEncryptedDataRow(encData: EncryptedDataRow, filename: string) {
  const json = JSON.stringify(encData)
  const blob = new Blob([json], { type: 'application/json' })
  const file = new File([blob], filename + '.enc.json')
  return file
}
