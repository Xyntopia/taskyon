import type { InvocationArtifact } from './designGraphModel.ts'
import type { InvocationRow } from './invocationExecution.ts'

export type InvocationRowStorageClient = {
  readBlobRange: (request: {
    namespace: string
    id: string
    offset: number
    length: number
  }) => Promise<{ data: Uint8Array<ArrayBuffer>; nextOffset: number; eof: boolean }>
}

const storageId = (hash: string) => hash.replace(':', '_')

const parseRow = (source: string): InvocationRow => {
  const value = JSON.parse(source) as unknown
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('rowId' in value) ||
    typeof value.rowId !== 'number' ||
    !('params' in value) ||
    typeof value.params !== 'object' ||
    value.params === null ||
    Array.isArray(value.params) ||
    !('objectives' in value) ||
    typeof value.objectives !== 'object' ||
    value.objectives === null ||
    Array.isArray(value.objectives) ||
    !('constraints' in value) ||
    typeof value.constraints !== 'object' ||
    value.constraints === null ||
    Array.isArray(value.constraints) ||
    !('feasible' in value) ||
    typeof value.feasible !== 'boolean'
  ) {
    throw new Error('Invocation rows artifact contains an invalid row.')
  }
  return value as InvocationRow
}

const parseIndexEntry = (source: string) => {
  const value = JSON.parse(source) as unknown
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('rowId' in value) ||
    typeof value.rowId !== 'number' ||
    !('offset' in value) ||
    typeof value.offset !== 'number' ||
    !('length' in value) ||
    typeof value.length !== 'number'
  ) {
    throw new Error('Invocation row-index artifact contains an invalid entry.')
  }
  return { rowId: value.rowId, offset: value.offset, length: value.length }
}

const iterateLines = async function* (args: {
  storage: InvocationRowStorageClient
  artifact: InvocationArtifact
  namespace: string
  chunkBytes: number
}): AsyncIterable<string> {
  const decoder = new TextDecoder()
  let offset = 0
  let pending = ''
  while (true) {
    const chunk = await args.storage.readBlobRange({
      namespace: args.namespace,
      id: storageId(args.artifact.id),
      offset,
      length: args.chunkBytes,
    })
    pending += decoder.decode(chunk.data, { stream: !chunk.eof })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) if (line) yield line
    if (chunk.eof) break
    if (chunk.nextOffset <= offset) throw new Error('Invocation artifact reader did not advance.')
    offset = chunk.nextOffset
  }
  if (pending) yield pending
}

export const iterateInvocationRowRange = async function* (args: {
  storage: InvocationRowStorageClient
  rows: InvocationArtifact
  rowIndex: InvocationArtifact
  startRow?: number
  limit?: number
  namespace?: string
  chunkBytes?: number
}): AsyncIterable<InvocationRow> {
  const startRow = Math.max(0, Math.floor(args.startRow ?? 0))
  const limit = Math.max(0, Math.floor(args.limit ?? Number.MAX_SAFE_INTEGER))
  if (limit === 0) return
  const namespace = args.namespace ?? 'design-graph/v2/artifacts'
  const chunkBytes = Math.max(1024, Math.floor(args.chunkBytes ?? 256 * 1024))
  let emitted = 0
  for await (const line of iterateLines({
    storage: args.storage,
    artifact: args.rowIndex,
    namespace,
    chunkBytes,
  })) {
    const entry = parseIndexEntry(line)
    if (entry.rowId < startRow) continue
    if (emitted >= limit) return
    const response = await args.storage.readBlobRange({
      namespace,
      id: storageId(args.rows.id),
      offset: entry.offset,
      length: entry.length,
    })
    if (response.data.byteLength !== entry.length) {
      throw new Error(`Invocation row ${entry.rowId} is incomplete.`)
    }
    yield parseRow(new TextDecoder().decode(response.data).trimEnd())
    emitted += 1
  }
}
