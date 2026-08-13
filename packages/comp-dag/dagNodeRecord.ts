import type { Hash } from './caching.ts'
import type { DagInputAccessor, DagNodeEffect } from './dagCore.ts'
import { hashCanonicalDagNodeSource } from './dagNodeIdentity.ts'
import type { DagJsonSchema } from './dagSchema.ts'
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
export type DagNodeRecordInputRef = DagNodeRecordInputRefSingle | DagNodeRecordInputRefOneOf

export type DagNodeRunContext = {
  params: Record<string, unknown>
  use: Record<string, DagInputAccessor>
  services: {
    fetch: typeof fetch
  }
}

export type DagNodeRunFunction = (ctx: DagNodeRunContext) => unknown

export type DagNodeRecordStructure = {
  kind: 'explode'
  sourceAlias: string
  path: string
}

export type DagNodeRecord = {
  formatVersion: 2
  id: Hash
  localName: string
  label: string
  version: number
  effect?: DagNodeEffect
  timeoutMs?: number
  structure?: DagNodeRecordStructure
  localParamsSchema: DagJsonSchema
  outputSchema: DagJsonSchema
  inputs?: Record<string, DagNodeRecordInputRef>
  hiddenInputs?: Record<string, DagNodeInputRefSingle>
  exposedInputs?: Record<string, DagNodeInputRefSingle | DagNodeInputRefOneOf>
  moduleLockId?: Hash
  importsSource?: string
  importSpecifiers?: readonly string[]
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

const sortedRecordValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortedRecordValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = sortedRecordValue((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

export const normalizeDagNodeRecordHashSource = (
  record: Omit<DagNodeRecord, 'id' | 'run' | 'runCode'>,
): string =>
  JSON.stringify(
    sortedRecordValue({
      label: record.label,
      localName: record.localName,
      formatVersion: record.formatVersion,
      version: record.version,
      ...(record.effect === 'source' ? { effect: 'source' } : {}),
      timeoutMs: record.timeoutMs ?? null,
      structure: record.structure ?? null,
      localParamsSchema: record.localParamsSchema,
      outputSchema: record.outputSchema,
      inputs: record.inputs ?? null,
      hiddenInputs: record.hiddenInputs ?? {},
      exposedInputs: record.exposedInputs ?? {},
      ...(record.moduleLockId ? { moduleLockId: record.moduleLockId } : {}),
      ...(record.importsSource ? { importsSource: record.importsSource } : {}),
      runSource: record.runSource,
      // This null slot is part of the v2 canonical identity. Module locks replace its former
      // purpose, but removing the slot would change every import-free node hash.
      staticDependencyFingerprint: null,
    }),
  )

export const hashDagNodeRecordInput = async (
  input: Omit<DagNodeRecord, 'id' | 'run' | 'runCode'>,
): Promise<Hash> =>
  await hashCanonicalDagNodeSource(
    JSON.stringify({
      kind: 'taskyon.dagNodeRecord.v2',
      source: normalizeDagNodeRecordHashSource(input),
    }),
  )

export const defineDagNodeRecord = async (
  input: Omit<DagNodeRecord, 'id'>,
): Promise<DagNodeRecord> => {
  assertDagNodeEffectSource(input.effect ?? 'pure', input.runSource)
  const hashSource = normalizeDagNodeRecordHashSource(input)
  const id = await hashCanonicalDagNodeSource(
    JSON.stringify({
      kind: 'taskyon.dagNodeRecord.v2',
      source: hashSource,
    }),
  )
  return {
    ...input,
    id,
  }
}
