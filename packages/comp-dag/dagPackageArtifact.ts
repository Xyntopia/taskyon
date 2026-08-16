import { sha256HashBytes } from '@taskyon/common/modules/canonicalHash'
import { STORED_DAG_PACKAGE_ALLOWLIST, type StoredDagPackageName } from './dagModule.ts'
import type { DagPackageArtifactResolver, DagPackageCompilerArtifact } from './dagModuleCompiler.ts'

export type DagRuntimePackageManifest = {
  schemaVersion: 1
  packages: Partial<
    Record<StoredDagPackageName, { version: string; integrity: string; path: string }>
  >
}

const packageVersion = (value: string, label: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value)
  if (!match) throw new Error(`${label} must use a semantic version.`)
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const
}

export const satisfiesDagPackageRange = (version: string, range: string): boolean => {
  const actual = packageVersion(version, 'Runtime package version')
  const trimmed = range.trim()
  const caret = trimmed.startsWith('^')
  const requested = packageVersion(caret ? trimmed.slice(1) : trimmed, 'DAG package range')
  if (!caret) return actual.every((part, index) => part === requested[index])
  const atLeastRequested =
    actual.some(
      (part, index) =>
        part > requested[index]! &&
        actual.slice(0, index).every((value, i) => value === requested[i]),
    ) || actual.every((part, index) => part === requested[index])
  if (!atLeastRequested) return false
  if (requested[0] > 0) return actual[0] === requested[0]
  if (requested[1] > 0) return actual[0] === 0 && actual[1] === requested[1]
  return actual[0] === 0 && actual[1] === 0 && actual[2] === requested[2]
}

export const parseDagRuntimePackageManifest = (value: unknown): DagRuntimePackageManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DAG runtime package manifest must be an object.')
  }
  if (Reflect.get(value, 'schemaVersion') !== 1) {
    throw new Error('Unsupported DAG runtime package manifest.')
  }
  const rawPackages = Reflect.get(value, 'packages')
  if (!rawPackages || typeof rawPackages !== 'object' || Array.isArray(rawPackages)) {
    throw new Error('DAG runtime package manifest packages must be an object.')
  }
  const packages: DagRuntimePackageManifest['packages'] = {}
  for (const [name, entry] of Object.entries(rawPackages)) {
    if (!STORED_DAG_PACKAGE_ALLOWLIST.includes(name as StoredDagPackageName)) {
      throw new Error(`DAG runtime package ${name} is not approved.`)
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`DAG runtime package ${name} must be an object.`)
    }
    const version = Reflect.get(entry, 'version')
    const integrity = Reflect.get(entry, 'integrity')
    const path = Reflect.get(entry, 'path')
    if (typeof version !== 'string' || typeof integrity !== 'string' || typeof path !== 'string') {
      throw new Error(`DAG runtime package ${name} requires version, integrity, and path.`)
    }
    packageVersion(version, `DAG runtime package ${name}`)
    if (!/^sha256:[A-Za-z0-9_-]{43}$/.test(integrity)) {
      throw new Error(`DAG runtime package ${name} has invalid integrity.`)
    }
    packages[name as StoredDagPackageName] = { version, integrity, path }
  }
  return { schemaVersion: 1, packages }
}

export const createDagPackageArtifactResolver = (args: {
  manifest: () => Promise<DagRuntimePackageManifest>
  loadSource: (path: string) => Promise<string>
}): DagPackageArtifactResolver => {
  let manifest: Promise<DagRuntimePackageManifest> | undefined
  const loadManifest = () => (manifest ??= args.manifest())
  return {
    resolve: async (requirements) => {
      if (Object.keys(requirements).length === 0) return []
      const available = (await loadManifest()).packages
      return await Promise.all(
        Object.entries(requirements).map(async ([name, requirement]) => {
          const entry = available[name as StoredDagPackageName]
          if (!entry) throw new Error(`Runtime package ${name} is unavailable.`)
          if (!satisfiesDagPackageRange(entry.version, requirement.range)) {
            throw new Error(
              `Runtime package ${name}@${entry.version} does not satisfy ${requirement.range}.`,
            )
          }
          return { name, version: entry.version, integrity: entry.integrity }
        }),
      )
    },
    load: async (resolved) => {
      const entry = (await loadManifest()).packages[resolved.name as StoredDagPackageName]
      if (!entry || entry.version !== resolved.version || entry.integrity !== resolved.integrity) {
        throw new Error(`Resolved runtime package ${resolved.name} changed before compilation.`)
      }
      const source = await args.loadSource(entry.path)
      const integrity = sha256HashBytes(new TextEncoder().encode(source))
      if (integrity !== entry.integrity) {
        throw new Error(`Runtime package ${resolved.name} failed its integrity check.`)
      }
      const artifact: DagPackageCompilerArtifact = { ...resolved, source }
      return artifact
    },
  }
}
