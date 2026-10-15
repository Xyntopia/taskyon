import { z } from 'zod'
import { canonicalHash } from './caching.ts'
import { parseGraphLock, type DagGraphLock } from './dagGraphAuthoring.ts'
import { parseDagModuleLock, type DagModuleLock } from './dagModule.ts'
import type { DagProjectedFile } from './dagGitProjection.ts'

export const isGraphSourceLock = (value: unknown) =>
  z.object({ kind: z.literal('taskyon.graph-source-lock') }).safeParse(value).success

export const createGraphSourceLock = (
  files: readonly DagProjectedFile[],
  graph: DagGraphLock,
  moduleLocks: ReadonlyMap<string, DagModuleLock>,
) => {
  const value = {
    kind: 'taskyon.graph-source-lock' as const,
    schemaVersion: 3 as const,
    supportHashes: Object.fromEntries(
      files
        .filter((file) => /^(modules|imports)\//.test(file.path))
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((file) => [file.path, canonicalHash(file.content)]),
    ),
    moduleLocks: Object.fromEntries([...moduleLocks].sort(([a], [b]) => (a < b ? -1 : 1))),
    graph,
  }
  return { ...value, id: canonicalHash(value) }
}

export const parseGraphSourceLock = (value: unknown) => {
  if (!z.object({ schemaVersion: z.literal(3) }).safeParse(value).success)
    throw new Error(
      'Unsupported graph source lock format. Run graph:lock to rebuild from authored sources.',
    )
  const parsed = z
    .object({
      kind: z.literal('taskyon.graph-source-lock'),
      schemaVersion: z.literal(3),
      supportHashes: z.record(z.string(), z.string()),
      moduleLocks: z.record(z.string(), z.unknown()),
      graph: z.unknown(),
      id: z.string(),
    })
    .strict()
    .parse(value)
  const { id, ...content } = parsed
  if (canonicalHash(content) !== id) throw new Error('Graph source lock integrity mismatch.')
  return {
    ...parsed,
    graph: parseGraphLock(parsed.graph),
    moduleLocks: new Map(
      Object.entries(parsed.moduleLocks).map(([name, lock]) => [name, parseDagModuleLock(lock)]),
    ),
  }
}
