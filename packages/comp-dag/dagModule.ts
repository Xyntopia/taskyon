import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import type { Hash } from './caching.ts'

export type DagModuleMediaType = 'application/javascript' | 'text/typescript'
export const STORED_DAG_PACKAGE_ALLOWLIST = ['fflate', 'zod', 'proj4', 'polygon-clipping'] as const
export type StoredDagPackageName = (typeof STORED_DAG_PACKAGE_ALLOWLIST)[number]

export type DagModuleArtifact = {
  schemaVersion: 1
  id: Hash
  mediaType: DagModuleMediaType
  source: string
}

export type DagModuleImportTarget =
  | { kind: 'module'; id: Hash }
  | { kind: 'package'; name: StoredDagPackageName }

export type DagLockedPackage = { range: string; version: string; integrity: Hash }

export type DagModuleLock = {
  schemaVersion: 3
  id: Hash
  resolver: { id: 'taskyon'; version: 3 }
  imports: Record<string, Record<string, DagModuleImportTarget>>
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
  imports: Record<string, Record<string, DagModuleImportTarget>>
  packages?: Partial<Record<StoredDagPackageName, DagLockedPackage>>
}): DagModuleLock => {
  const importedPackages = new Set(
    Object.values(input.imports).flatMap((imports) =>
      Object.values(imports).flatMap((target) => (target.kind === 'package' ? [target.name] : [])),
    ),
  )
  for (const name of importedPackages) {
    if (!input.packages?.[name]) {
      throw new Error(`Imported runtime package ${name} requires a locked compatibility range.`)
    }
  }
  for (const name of Object.keys(input.packages ?? {})) {
    const pkg = input.packages![name as StoredDagPackageName]!
    if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(pkg.version))
      throw new Error(`Locked package ${name} requires an exact semantic version.`)
    moduleHashAtBoundary(pkg.integrity, `Locked package ${name} integrity`)
    if (!importedPackages.has(name as StoredDagPackageName)) {
      throw new Error(`Locked runtime package ${name} is not imported by the module closure.`)
    }
  }
  const value = {
    schemaVersion: 3 as const,
    resolver: { id: 'taskyon' as const, version: 3 as const },
    imports: input.imports,
    packages: input.packages ?? {},
  }
  return { ...value, id: createModuleIdentity('taskyon.dagModuleLock.v3', value) }
}

const parseImportTarget = (value: unknown, label: string): DagModuleImportTarget => {
  const target = moduleObjectAtBoundary(value, label)
  if (target.kind === 'module') {
    return { kind: 'module', id: moduleHashAtBoundary(target.id, `${label} module`) }
  }
  if (
    target.kind === 'package' &&
    typeof target.name === 'string' &&
    STORED_DAG_PACKAGE_ALLOWLIST.includes(target.name as StoredDagPackageName)
  ) {
    return { kind: 'package', name: target.name as StoredDagPackageName }
  }
  throw new Error(`${label} must target an approved package or stored module.`)
}

export const parseDagModuleLock = (value: unknown): DagModuleLock => {
  const input = moduleObjectAtBoundary(value, 'DAG module lock')
  const resolver = moduleObjectAtBoundary(input.resolver, 'DAG module lock resolver')
  if (input.schemaVersion !== 3 || resolver.id !== 'taskyon' || resolver.version !== 3) {
    throw new Error('Unsupported DAG module lock.')
  }
  const imports = Object.fromEntries(
    Object.entries(moduleObjectAtBoundary(input.imports, 'DAG module lock imports')).map(
      ([referrer, mappings]) => [
        referrer,
        Object.fromEntries(
          Object.entries(moduleObjectAtBoundary(mappings, `Imports for ${referrer}`)).map(
            ([specifier, target]) => [
              specifier,
              parseImportTarget(target, `Import ${referrer}:${specifier}`),
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
        if (typeof pkg.range !== 'string' || !pkg.range.trim()) {
          throw new Error(`Locked package ${name} requires a compatibility range.`)
        }
        if (typeof pkg.version !== 'string' || !pkg.version.trim())
          throw new Error(`Locked runtime package ${name} requires an exact version.`)
        return [
          name,
          {
            range: pkg.range,
            version: pkg.version,
            integrity: moduleHashAtBoundary(pkg.integrity, `Locked package ${name} integrity`),
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
    ...Object.values(lock.imports).flatMap((imports) =>
      Object.values(imports).flatMap((target) => (target.kind === 'module' ? [target.id] : [])),
    ),
  ]),
]
