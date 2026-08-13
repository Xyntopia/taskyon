import { canonicalHash, type Hash } from './caching.ts'

export type DerivedPredicate = {
  path: string
  operator: '==' | '!=' | '<' | '<=' | '>' | '>='
  value: unknown
}

export type DerivedOperation =
  | { kind: 'select'; path: string }
  | { kind: 'index'; index: number }
  | { kind: 'filter'; predicate: DerivedPredicate }
  | { kind: 'map'; fields: Record<string, string> }
  | { kind: 'reduce'; reducer: 'sum' | 'mean' | 'min' | 'max' | 'argmin' | 'argmax' }

export type DerivedExpression = {
  schemaVersion: 1
  id: Hash
  sourceArtifactId: Hash
  operations: DerivedOperation[]
}

export type DerivedResultCache = {
  get: (key: Hash) => Promise<{ hit: false } | { hit: true; value: unknown }>
  set: (key: Hash, value: unknown) => Promise<void>
}

export const createDerivedExpression = (
  input: Omit<DerivedExpression, 'schemaVersion' | 'id'>,
): DerivedExpression => {
  const value = {
    schemaVersion: 1 as const,
    sourceArtifactId: input.sourceArtifactId,
    operations: [...input.operations],
  }
  return {
    ...value,
    id: canonicalHash({ kind: 'taskyon.derivedExpression.v1', ...value }),
  }
}

const valueAtPath = (source: unknown, path: string): unknown => {
  if (!path || path === '$') return source
  return path.split('.').reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null) return undefined
    return (current as Record<string, unknown>)[key]
  }, source)
}

const matchesPredicate = (source: unknown, predicate: DerivedPredicate): boolean => {
  const left = valueAtPath(source, predicate.path)
  const right = predicate.value
  switch (predicate.operator) {
    case '==':
      return left === right
    case '!=':
      return left !== right
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right
  }
}

const applyNonReducer = (
  value: unknown,
  operation: Exclude<DerivedOperation, { kind: 'reduce' }>,
) => {
  switch (operation.kind) {
    case 'select':
      return { include: true, value: valueAtPath(value, operation.path) }
    case 'index':
      return {
        include: true,
        value: Array.isArray(value) ? value[operation.index] : undefined,
      }
    case 'filter':
      return { include: matchesPredicate(value, operation.predicate), value }
    case 'map':
      return {
        include: true,
        value: Object.fromEntries(
          Object.entries(operation.fields).map(([name, path]) => [name, valueAtPath(value, path)]),
        ),
      }
  }
}

export const streamDerivedExpression = async function* (args: {
  expression: DerivedExpression
  readRows: () => AsyncIterable<unknown>
}): AsyncIterable<unknown> {
  const operations = args.expression.operations.filter(
    (operation): operation is Exclude<DerivedOperation, { kind: 'reduce' }> =>
      operation.kind !== 'reduce',
  )
  for await (const row of args.readRows()) {
    let current = row
    let include = true
    for (const operation of operations) {
      const result = applyNonReducer(current, operation)
      include = result.include
      current = result.value
      if (!include) break
    }
    if (include) yield current
  }
}

const requireNumber = (value: unknown, reducer: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Derived ${reducer} requires finite numeric values.`)
  }
  return value
}

const reduceStream = async (
  values: AsyncIterable<unknown> | Iterable<unknown>,
  reducer: Extract<DerivedOperation, { kind: 'reduce' }>['reducer'],
): Promise<unknown> => {
  let count = 0
  let sum = 0
  let extreme: number | undefined
  let extremeSource: unknown
  for await (const value of values) {
    const numeric = requireNumber(value, reducer)
    count += 1
    sum += numeric
    if (
      extreme === undefined ||
      ((reducer === 'min' || reducer === 'argmin') && numeric < extreme) ||
      ((reducer === 'max' || reducer === 'argmax') && numeric > extreme)
    ) {
      extreme = numeric
      extremeSource = value
    }
  }
  if (reducer === 'sum') return sum
  if (reducer === 'mean') return count === 0 ? null : sum / count
  if (extreme === undefined) return null
  return reducer === 'argmin' || reducer === 'argmax' ? extremeSource : extreme
}

const arrayValues = function* (value: unknown): Iterable<unknown> {
  if (!Array.isArray(value)) throw new Error('Derived reducer input must be an array.')
  yield* value
}

export const evaluateDerivedOperations = async (
  source: unknown,
  operations: readonly DerivedOperation[],
): Promise<unknown> => {
  let current = source
  for (const operation of operations) {
    if (operation.kind === 'reduce')
      return await reduceStream(arrayValues(current), operation.reducer)
    const result = applyNonReducer(current, operation)
    if (!result.include) return undefined
    current = result.value
  }
  return current
}

export const evaluateDerivedExpression = async (args: {
  expression: DerivedExpression
  readRows: () => AsyncIterable<unknown>
  cache: DerivedResultCache
}): Promise<unknown> => {
  const cached = await args.cache.get(args.expression.id)
  if (cached.hit) return cached.value
  const reducer = args.expression.operations.at(-1)
  if (reducer?.kind !== 'reduce') {
    throw new Error('A materialized derived expression must end with a reducer.')
  }
  const expressionWithoutReducer = createDerivedExpression({
    sourceArtifactId: args.expression.sourceArtifactId,
    operations: args.expression.operations.slice(0, -1),
  })
  const value = await reduceStream(
    streamDerivedExpression({ expression: expressionWithoutReducer, readRows: args.readRows }),
    reducer.reducer,
  )
  await args.cache.set(args.expression.id, value)
  return value
}
