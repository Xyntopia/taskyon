import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import type { Hash } from './caching.ts'

export type DagModuleMediaType = 'application/javascript' | 'text/typescript'
export const STORED_DAG_PACKAGE_ALLOWLIST = ['fflate', 'zod'] as const
export type StoredDagPackageName = (typeof STORED_DAG_PACKAGE_ALLOWLIST)[number]

export type DagModuleArtifact = {
  schemaVersion: 1
  id: Hash
  mediaType: DagModuleMediaType
  source: string
}

export type DagLockedPackage = {
  version: string
  integrity: string
  moduleId: Hash
}

export type DagModuleLock = {
  schemaVersion: 1
  id: Hash
  resolver: { id: 'taskyon'; version: 1 }
  imports: Record<string, Record<string, Hash>>
  packages: Partial<Record<StoredDagPackageName, DagLockedPackage>>
}

const hashPattern = /^sha256:(?:[a-f0-9]{64}|[A-Za-z0-9_-]{43})$/

const moduleObjectAtBoundary = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

const moduleHashAtBoundary = (value: unknown, label: string): Hash => {
  if (typeof value !== 'string' || !hashPattern.test(value)) {
    throw new Error(`${label} must be a canonical sha256 hash.`)
  }
  return value as Hash
}

const createModuleIdentity = (kind: string, value: object): Hash =>
  canonicalHash({ kind, ...value })

export const createDagModuleArtifact = (input: {
  mediaType: DagModuleMediaType
  source: string
}): DagModuleArtifact => {
  const value = { schemaVersion: 1 as const, mediaType: input.mediaType, source: input.source }
  return { ...value, id: createModuleIdentity('taskyon.dagModule.v1', value) }
}

export const parseDagModuleArtifact = (value: unknown): DagModuleArtifact => {
  const input = moduleObjectAtBoundary(value, 'DAG module')
  if (
    input.schemaVersion !== 1 ||
    (input.mediaType !== 'application/javascript' && input.mediaType !== 'text/typescript') ||
    typeof input.source !== 'string'
  ) {
    throw new Error('Unsupported DAG module artifact.')
  }
  const artifact = createDagModuleArtifact({ mediaType: input.mediaType, source: input.source })
  if (moduleHashAtBoundary(input.id, 'DAG module id') !== artifact.id) {
    throw new Error('DAG module hash does not match its content.')
  }
  return artifact
}

export const createDagModuleLock = (input: {
  imports: Record<string, Record<string, Hash>>
  packages?: Partial<Record<StoredDagPackageName, DagLockedPackage>>
}): DagModuleLock => {
  const value = {
    schemaVersion: 1 as const,
    resolver: { id: 'taskyon' as const, version: 1 as const },
    imports: input.imports,
    packages: input.packages ?? {},
  }
  return { ...value, id: createModuleIdentity('taskyon.dagModuleLock.v1', value) }
}

export const parseDagModuleLock = (value: unknown): DagModuleLock => {
  const input = moduleObjectAtBoundary(value, 'DAG module lock')
  const resolver = moduleObjectAtBoundary(input.resolver, 'DAG module lock resolver')
  if (input.schemaVersion !== 1 || resolver.id !== 'taskyon' || resolver.version !== 1) {
    throw new Error('Unsupported DAG module lock.')
  }
  const imports = Object.fromEntries(
    Object.entries(moduleObjectAtBoundary(input.imports, 'DAG module lock imports')).map(
      ([referrer, mappings]) => [
        referrer,
        Object.fromEntries(
          Object.entries(moduleObjectAtBoundary(mappings, `Imports for ${referrer}`)).map(
            ([specifier, moduleId]) => [
              specifier,
              moduleHashAtBoundary(moduleId, `Import ${referrer}:${specifier}`),
            ],
          ),
        ),
      ],
    ),
  )
  const packages = Object.fromEntries(
    Object.entries(moduleObjectAtBoundary(input.packages, 'DAG module lock packages')).map(
      ([name, value]) => {
        if (!STORED_DAG_PACKAGE_ALLOWLIST.includes(name as StoredDagPackageName)) {
          throw new Error(`Stored DAG package ${name} is not in the runtime allowlist.`)
        }
        const pkg = moduleObjectAtBoundary(value, `Locked package ${name}`)
        if (typeof pkg.version !== 'string' || typeof pkg.integrity !== 'string') {
          throw new Error(`Locked package ${name} requires version and integrity.`)
        }
        return [
          name,
          {
            version: pkg.version,
            integrity: pkg.integrity,
            moduleId: moduleHashAtBoundary(pkg.moduleId, `Locked package ${name} module`),
          },
        ]
      },
    ),
  )
  const lock = createDagModuleLock({
    imports,
    packages: packages as Partial<Record<StoredDagPackageName, DagLockedPackage>>,
  })
  if (moduleHashAtBoundary(input.id, 'DAG module lock id') !== lock.id) {
    throw new Error('DAG module lock hash does not match its content.')
  }
  return lock
}

export const getDagModuleLockModuleIds = (lock: DagModuleLock): Hash[] => [
  ...new Set([
    ...Object.values(lock.imports).flatMap((imports) => Object.values(imports)),
    ...Object.values(lock.packages).map((pkg) => pkg.moduleId),
  ]),
]
