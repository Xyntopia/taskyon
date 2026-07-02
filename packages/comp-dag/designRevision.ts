import { canonicalHash, type Hash } from './caching'
import type { StudyOptions } from './dagCore'

export type DesignRevisionId = Hash
export type DesignObjectId = Hash

export type GraphOutputRef = {
  nodeId: Hash
  output: '$'
}

export type DesignSpaceRecordV1 = {
  schemaVersion: 1
  id: DesignObjectId
  variables: Record<string, unknown>
  objectives: unknown[]
  constraints: unknown[]
  inputPolicies: Record<string, unknown>
}

export type DesignInputRole =
  | 'design'
  | 'requirement'
  | 'scenario'
  | 'preference'
  | 'uncertainty'
  | 'fixed'

export type DesignInputDomain =
  | { kind: 'continuous'; min: number; max: number; step?: number }
  | { kind: 'integer'; min: number; max: number; step?: number }
  | { kind: 'categorical'; values: Array<string | number | boolean> }
  | { kind: 'structural'; inputAlias: string }
  | { kind: 'fixed' }

export type DesignInputSpec = {
  role: DesignInputRole
  label: string
  description?: string
  unit?: string
  domain: DesignInputDomain
}

export type DesignObjectiveSpec = {
  id: string
  label: string
  path: string
  direction: 'min' | 'max'
  unit?: string
}

export type DesignConstraintSpec = {
  id: string
  label: string
  path: string
  operator: '<=' | '>=' | '=='
  limit: string | number | boolean
  unit?: string
}

export type DesignSpaceRecordV2 = {
  schemaVersion: 2
  id: DesignObjectId
  inputs: Record<string, DesignInputSpec>
  objectives: DesignObjectiveSpec[]
  constraints: DesignConstraintSpec[]
  allowedAlternatives: Record<string, string[]>
}

export type DesignSpaceRecord = DesignSpaceRecordV1 | DesignSpaceRecordV2

export type DesignRevisionV1 = {
  schemaVersion: 1
  id: DesignRevisionId
  parents: DesignRevisionId[]
  roots: Record<string, GraphOutputRef>
  designSpaceId: DesignObjectId
}

export type DesignRevisionMetadataV1 = {
  schemaVersion: 1
  revisionId: DesignRevisionId
  message?: string
  taskIds?: string[]
  evidence?: Hash[]
  createdAtMs?: number
}

export type DesignStudyConfig = Omit<StudyOptions, 'onRow' | 'mode'> & {
  mode: 'explore' | 'optimize'
}

export type DesignExecutionConfigV1 =
  | {
      schemaVersion: 1
      kind: 'design'
      params: Record<string, unknown>
    }
  | {
      schemaVersion: 1
      kind: 'study'
      config: DesignStudyConfig & { mode: 'explore' }
    }
  | {
      schemaVersion: 1
      kind: 'optimization'
      config: DesignStudyConfig & { mode: 'optimize' }
    }

export type DesignExecutionConfigInput =
  | { kind: 'design'; params: Record<string, unknown> }
  | { kind: 'study'; config: DesignStudyConfig & { mode: 'explore' } }
  | { kind: 'optimization'; config: DesignStudyConfig & { mode: 'optimize' } }

export type DesignEvaluationRecordV1 = {
  schemaVersion: 1
  id: DesignObjectId
  revisionId: DesignRevisionId
  rootName: string
  executionConfigId: DesignObjectId
  resultArtifactId: Hash
}

export type DesignRefV1 = {
  schemaVersion: 1
  revisionId: DesignRevisionId
}

export type SavedDesignRefV1 = {
  schemaVersion: 1
  name: string
  evaluationId: DesignObjectId
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireHash = (value: unknown, label: string): Hash => {
  if (typeof value !== 'string' || !/^sha256:(?:[a-f0-9]{64}|[A-Za-z0-9_-]{43})$/.test(value)) {
    throw new Error(`${label} must be a canonical sha256 hash.`)
  }
  return value as Hash
}

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string.`)
  return value
}

const hashRecord = <T extends { id: Hash }>(record: Omit<T, 'id'>): T =>
  ({
    ...record,
    id: canonicalHash(record),
  }) as T

export const createDesignSpaceRecord = (
  input: Omit<DesignSpaceRecordV1, 'id' | 'schemaVersion'>,
): DesignSpaceRecordV1 =>
  hashRecord<DesignSpaceRecordV1>({
    schemaVersion: 1,
    variables: input.variables,
    objectives: input.objectives,
    constraints: input.constraints,
    inputPolicies: input.inputPolicies,
  })

export const createEmptyDesignSpaceRecord = (): DesignSpaceRecordV1 =>
  createDesignSpaceRecord({
    variables: {},
    objectives: [],
    constraints: [],
    inputPolicies: {},
  })

export const createDesignSpaceRecordV2 = (
  input: Omit<DesignSpaceRecordV2, 'id' | 'schemaVersion'>,
): DesignSpaceRecordV2 =>
  hashRecord<DesignSpaceRecordV2>({
    schemaVersion: 2,
    inputs: input.inputs,
    objectives: input.objectives,
    constraints: input.constraints,
    allowedAlternatives: input.allowedAlternatives,
  })

export const createDesignRevision = (
  input: Omit<DesignRevisionV1, 'id' | 'schemaVersion'>,
): DesignRevisionV1 =>
  hashRecord<DesignRevisionV1>({
    schemaVersion: 1,
    parents: [...input.parents],
    roots: input.roots,
    designSpaceId: input.designSpaceId,
  })

export const createDesignExecutionConfig = (
  input: DesignExecutionConfigInput,
): { id: DesignObjectId; value: DesignExecutionConfigV1 } => {
  const value = { schemaVersion: 1, ...input } as DesignExecutionConfigV1
  return { id: canonicalHash(value), value }
}

export const createDesignEvaluationRecord = (
  input: Omit<DesignEvaluationRecordV1, 'id' | 'schemaVersion'>,
): DesignEvaluationRecordV1 =>
  hashRecord<DesignEvaluationRecordV1>({
    schemaVersion: 1,
    revisionId: input.revisionId,
    rootName: input.rootName,
    executionConfigId: input.executionConfigId,
    resultArtifactId: input.resultArtifactId,
  })

const parseDesignInputDomain = (value: unknown, path: string): DesignInputDomain => {
  if (!isObject(value) || typeof value.kind !== 'string') {
    throw new Error(`${path}.domain must be an object.`)
  }
  if (value.kind === 'fixed') return { kind: 'fixed' }
  if (value.kind === 'structural') {
    return {
      kind: 'structural',
      inputAlias: requireString(value.inputAlias, `${path}.domain.inputAlias`),
    }
  }
  if (value.kind === 'categorical') {
    if (
      !Array.isArray(value.values) ||
      value.values.some(
        (item) => typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean',
      )
    ) {
      throw new Error(`${path}.domain.values must contain scalar values.`)
    }
    return { kind: 'categorical', values: value.values }
  }
  if (value.kind === 'continuous' || value.kind === 'integer') {
    if (typeof value.min !== 'number' || typeof value.max !== 'number') {
      throw new Error(`${path}.domain requires numeric min and max.`)
    }
    return {
      kind: value.kind,
      min: value.min,
      max: value.max,
      ...(typeof value.step === 'number' ? { step: value.step } : {}),
    }
  }
  throw new Error(`${path}.domain has an unsupported kind.`)
}

const parseDesignInputSpec = (value: unknown, path: string): DesignInputSpec => {
  if (!isObject(value)) throw new Error(`${path} must be an object.`)
  const roles: DesignInputRole[] = [
    'design',
    'requirement',
    'scenario',
    'preference',
    'uncertainty',
    'fixed',
  ]
  if (!roles.includes(value.role as DesignInputRole)) throw new Error(`${path}.role is invalid.`)
  return {
    role: value.role as DesignInputRole,
    label: requireString(value.label, `${path}.label`),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.unit === 'string' ? { unit: value.unit } : {}),
    domain: parseDesignInputDomain(value.domain, path),
  }
}

const parseDesignObjective = (value: unknown, index: number): DesignObjectiveSpec => {
  if (!isObject(value) || (value.direction !== 'min' && value.direction !== 'max')) {
    throw new Error(`Design objective ${index} is invalid.`)
  }
  return {
    id: requireString(value.id, `Design objective ${index} id`),
    label: requireString(value.label, `Design objective ${index} label`),
    path: requireString(value.path, `Design objective ${index} path`),
    direction: value.direction,
    ...(typeof value.unit === 'string' ? { unit: value.unit } : {}),
  }
}

const parseDesignConstraint = (value: unknown, index: number): DesignConstraintSpec => {
  if (
    !isObject(value) ||
    (value.operator !== '<=' && value.operator !== '>=' && value.operator !== '==') ||
    (typeof value.limit !== 'string' &&
      typeof value.limit !== 'number' &&
      typeof value.limit !== 'boolean')
  ) {
    throw new Error(`Design constraint ${index} is invalid.`)
  }
  return {
    id: requireString(value.id, `Design constraint ${index} id`),
    label: requireString(value.label, `Design constraint ${index} label`),
    path: requireString(value.path, `Design constraint ${index} path`),
    operator: value.operator,
    limit: value.limit,
    ...(typeof value.unit === 'string' ? { unit: value.unit } : {}),
  }
}

export const parseDesignSpaceRecord = (value: unknown): DesignSpaceRecord => {
  if (!isObject(value)) {
    throw new Error('Invalid design-space record version.')
  }
  if (value.schemaVersion === 2) {
    if (
      !isObject(value.inputs) ||
      !Array.isArray(value.objectives) ||
      !Array.isArray(value.constraints) ||
      !isObject(value.allowedAlternatives)
    ) {
      throw new Error('Invalid version 2 design-space record.')
    }
    const record = createDesignSpaceRecordV2({
      inputs: Object.fromEntries(
        Object.entries(value.inputs).map(([path, spec]) => [
          path,
          parseDesignInputSpec(spec, `Design input ${path}`),
        ]),
      ),
      objectives: value.objectives.map(parseDesignObjective),
      constraints: value.constraints.map(parseDesignConstraint),
      allowedAlternatives: Object.fromEntries(
        Object.entries(value.allowedAlternatives).map(([alias, ids]) => {
          if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
            throw new Error(`Allowed alternatives for ${alias} must be strings.`)
          }
          return [alias, ids]
        }),
      ),
    })
    if (requireHash(value.id, 'Design-space id') !== record.id) {
      throw new Error('Design-space record hash does not match its content.')
    }
    return record
  }
  if (value.schemaVersion !== 1) throw new Error('Invalid design-space record version.')
  const record = createDesignSpaceRecord({
    variables: isObject(value.variables) ? value.variables : {},
    objectives: Array.isArray(value.objectives) ? value.objectives : [],
    constraints: Array.isArray(value.constraints) ? value.constraints : [],
    inputPolicies: isObject(value.inputPolicies) ? value.inputPolicies : {},
  })
  if (requireHash(value.id, 'Design-space id') !== record.id) {
    throw new Error('Design-space record hash does not match its content.')
  }
  return record
}

export const parseDesignRevision = (value: unknown): DesignRevisionV1 => {
  if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.roots)) {
    throw new Error('Invalid design revision.')
  }
  const roots = Object.fromEntries(
    Object.entries(value.roots).map(([name, root]) => {
      if (!isObject(root) || root.output !== '$') throw new Error(`Invalid root output: ${name}`)
      return [name, { nodeId: requireHash(root.nodeId, `Root ${name}`), output: '$' as const }]
    }),
  )
  const parents = Array.isArray(value.parents)
    ? value.parents.map((parent, index) => requireHash(parent, `Revision parent ${index}`))
    : []
  const record = createDesignRevision({
    parents,
    roots,
    designSpaceId: requireHash(value.designSpaceId, 'Design-space id'),
  })
  if (requireHash(value.id, 'Revision id') !== record.id) {
    throw new Error('Design revision hash does not match its content.')
  }
  return record
}

export const parseDesignRef = (value: unknown): DesignRefV1 => {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error('Invalid design ref.')
  return { schemaVersion: 1, revisionId: requireHash(value.revisionId, 'Ref revision id') }
}

export const parseDesignEvaluationRecord = (value: unknown): DesignEvaluationRecordV1 => {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error('Invalid design evaluation.')
  const record = createDesignEvaluationRecord({
    revisionId: requireHash(value.revisionId, 'Evaluation revision id'),
    rootName: requireString(value.rootName, 'Evaluation root name'),
    executionConfigId: requireHash(value.executionConfigId, 'Execution config id'),
    resultArtifactId: requireHash(value.resultArtifactId, 'Result artifact id'),
  })
  if (requireHash(value.id, 'Evaluation id') !== record.id) {
    throw new Error('Design evaluation hash does not match its content.')
  }
  return record
}
