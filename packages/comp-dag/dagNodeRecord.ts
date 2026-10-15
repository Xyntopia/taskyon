import { canonicalHash, type Hash } from './caching.ts'
import { canonicalJson } from '@taskyon/common/modules/canonicalHash'
import type { DagInputAccessor, DagNodeEffect } from './dagCore.ts'
import { hashCanonicalDagNodeSource } from './dagNodeIdentity.ts'
import type { DagJsonSchema } from './dagSchema.ts'
import type { FetchWithPolicy } from '@taskyon/common/modules/webFetching/mediatedFetch.ts'
import { assertDagNodeEffectSource } from './dagNodeEffectCheck.ts'

export type DagNodeInputRefSingle = { nodeId: Hash }
export type DagNodeInputRefOneOf = {
  kind: 'oneOf'
  nodeIds: Hash[]
}

export type DagNodeInputRole = 'internal' | 'exposed'
export type DagNodeRecordInputRefSingle = DagNodeInputRefSingle & {
  role: DagNodeInputRole
}
export type DagNodeRecordInputRefOneOf = DagNodeInputRefOneOf & {
  role: 'exposed'
}

/** The bounded sandbox response supports whole-body reads, not browser Response streaming APIs. */
export type DagFetchResponse = {
  status: number
  statusText: string
  ok: boolean
  headers: Pick<Headers, 'get' | 'has' | 'entries'>
  arrayBuffer: () => Promise<ArrayBuffer>
  text: () => Promise<string>
  json: () => Promise<unknown>
}
export type DagNodeRecordInputRef = DagNodeRecordInputRefSingle | DagNodeRecordInputRefOneOf

export type DagNodeRunContext = {
  params: Record<string, unknown>
  use: Record<string, DagInputAccessor>
  services: {
    fetch: (...args: Parameters<FetchWithPolicy>) => Promise<DagFetchResponse>
    callCapability: (id: string, input: unknown) => Promise<unknown>
  }
}

export type DagNodeRunFunction = (ctx: DagNodeRunContext) => unknown

export type DagNodeRecordStructure =
  | {
      kind: 'explode'
      sourceAlias: string
      path: string
    }
  | { kind: 'select'; sourceAlias: string; path: string }
  | { kind: 'choose'; parameter: string; default: string }

/** Versioned library semantics: bump this identity whenever structural execution behavior changes. */
export const getDagStructuralDefinitionHash = (kind: DagNodeRecordStructure['kind']) =>
  canonicalHash({ kind: 'taskyon.structuralDefinition.v1', operation: kind, semanticsVersion: 1 })

export type DagNodeRecord = {
  formatVersion: 2 | 3
  id: Hash
  localName: string
  label: string
  version: number
  definitionHash?: Hash
  effect?: DagNodeEffect
  timeoutMs?: number
  structure?: DagNodeRecordStructure
  localParamsSchema: DagJsonSchema
  outputSchema: DagJsonSchema
  capabilities?: readonly string[]
  inputs?: Record<string, DagNodeRecordInputRef>
  hiddenInputs?: Record<string, DagNodeInputRefSingle>
  exposedInputs?: Record<string, DagNodeInputRefSingle | DagNodeInputRefOneOf>
  moduleLockId?: Hash
  importsSource?: string
  importSpecifiers?: readonly string[]
  preambleSource?: string
  runSource: string
  runCode?: string
  run?: DagNodeRunFunction
}

export const recordInputsToRuntimeInputs = (
  record: Pick<DagNodeRecord, 'inputs' | 'hiddenInputs' | 'exposedInputs'>,
): {
  hiddenInputs: Record<string, DagNodeInputRefSingle>
  exposedInputs: Record<string, DagNodeInputRefSingle | DagNodeInputRefOneOf>
} => {
  if (!record.inputs) {
    return {
      hiddenInputs: record.hiddenInputs ?? {},
      exposedInputs: record.exposedInputs ?? {},
    }
  }

  const hiddenInputs: Record<string, DagNodeInputRefSingle> = {}
  const exposedInputs: Record<string, DagNodeInputRefSingle | DagNodeInputRefOneOf> = {}
  for (const [alias, ref] of Object.entries(record.inputs)) {
    if (ref.role === 'internal') {
      if ('kind' in ref) {
        throw new Error(`DagNodeRecord input "${alias}" cannot use oneOf with internal role`)
      }
      hiddenInputs[alias] = { nodeId: ref.nodeId }
    } else if ('kind' in ref) {
      exposedInputs[alias] = { kind: 'oneOf', nodeIds: ref.nodeIds }
    } else {
      exposedInputs[alias] = { nodeId: ref.nodeId }
    }
  }
  return { hiddenInputs, exposedInputs }
}

export const runtimeInputsToRecordInputs = (args: {
  hiddenInputs?: Record<string, DagNodeInputRefSingle>
  exposedInputs?: Record<string, DagNodeInputRefSingle | DagNodeInputRefOneOf>
}): Record<string, DagNodeRecordInputRef> => {
  const inputs: Record<string, DagNodeRecordInputRef> = {}
  for (const [alias, ref] of Object.entries(args.hiddenInputs ?? {})) {
    inputs[alias] = { ...ref, role: 'internal' }
  }
  for (const [alias, ref] of Object.entries(args.exposedInputs ?? {})) {
    inputs[alias] = 'kind' in ref ? { ...ref, role: 'exposed' } : { ...ref, role: 'exposed' }
  }
  return inputs
}

export const getDagNodeRecordInputHashes = (record: DagNodeRecord): Hash[] =>
  Object.values(recordInputsToRuntimeInputs(record)).flatMap((inputMap) =>
    Object.values(inputMap).flatMap((ref) => ('kind' in ref ? ref.nodeIds : [ref.nodeId])),
  )

export const normalizeDagNodeRecordHashSource = (
  record: Omit<DagNodeRecord, 'id' | 'run' | 'runCode'>,
): string =>
  canonicalJson({
    ...(record.formatVersion === 2 ? { label: record.label, localName: record.localName } : {}),
    formatVersion: record.formatVersion,
    ...(record.formatVersion === 3 ? { runtimeSemantics: 'taskyon.dag.v3' } : {}),
    version: record.version,
    ...(record.definitionHash ? { definitionHash: record.definitionHash } : {}),
    ...(record.effect === 'source' ? { effect: 'source' } : {}),
    timeoutMs: record.timeoutMs ?? null,
    structure: record.structure ?? null,
    localParamsSchema: record.localParamsSchema,
    outputSchema: record.outputSchema,
    ...(record.capabilities?.length ? { capabilities: record.capabilities } : {}),
    inputs: record.inputs ?? null,
    hiddenInputs: record.hiddenInputs ?? {},
    exposedInputs: record.exposedInputs ?? {},
    ...(record.moduleLockId ? { moduleLockId: record.moduleLockId } : {}),
    ...(record.importsSource ? { importsSource: record.importsSource } : {}),
    ...(record.preambleSource ? { preambleSource: record.preambleSource } : {}),
    runSource: record.runSource,
    // This null slot is part of the v2 canonical identity. Module locks replace its former
    // purpose, but removing the slot would change every import-free node hash.
    staticDependencyFingerprint: null,
  })

export const hashDagNodeRecordInput = async (
  input: Omit<DagNodeRecord, 'id' | 'run' | 'runCode'>,
): Promise<Hash> =>
  await hashCanonicalDagNodeSource(
    JSON.stringify({
      kind: `taskyon.dagNodeRecord.v${input.formatVersion}`,
      source: normalizeDagNodeRecordHashSource(input),
    }),
  )

export const defineDagNodeRecord = async (
  input: Omit<DagNodeRecord, 'id'>,
): Promise<DagNodeRecord> => {
  assertDagNodeEffectSource(
    input.effect ?? 'pure',
    `${input.preambleSource ?? ''}\n${input.runSource}`,
  )
  const hashSource = normalizeDagNodeRecordHashSource(input)
  const id = await hashCanonicalDagNodeSource(
    JSON.stringify({
      kind: `taskyon.dagNodeRecord.v${input.formatVersion}`,
      source: hashSource,
    }),
  )
  return {
    ...input,
    id,
  }
}
