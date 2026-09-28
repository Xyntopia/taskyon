export type GridOrder = 'coarseToFine' | 'sequential'

export type CandidateDimension = {
  path: string
  kind: 'grid' | 'list'
  length: number
  offset?: number
  valueAt: (index: number) => unknown
}

const firstStride = (length: number) => {
  let stride = 1
  while (stride * 2 < length) stride *= 2
  return stride
}

const gridIndicesAtStride = function* (
  lengths: number[],
  strides: number[],
  offsets: number[],
  index = 0,
  current: number[] = [],
): Iterable<number[]> {
  if (index === lengths.length) {
    yield current
    return
  }
  const stride = strides[index]!
  const offset = offsets[index]!
  const first = ((-offset % stride) + stride) % stride
  for (let value = first; value < lengths[index]!; value += stride) {
    yield* gridIndicesAtStride(lengths, strides, offsets, index + 1, [...current, value])
  }
}

const orderedGridIndices = function* (lengths: number[], offsets: number[]): Iterable<number[]> {
  const initialStrides = lengths.map(firstStride)
  const levels = Math.max(0, ...initialStrides.map((stride) => Math.log2(stride)))
  for (let level = 0; level <= levels; level += 1) {
    const strides = initialStrides.map((stride) => Math.max(1, stride / 2 ** level))
    const previous = initialStrides.map((stride) => Math.max(1, stride / 2 ** (level - 1)))
    for (const indices of gridIndicesAtStride(lengths, strides, offsets)) {
      if (
        level === 0 ||
        indices.some((value, index) => (value + offsets[index]!) % previous[index]! !== 0)
      ) {
        yield indices
      }
    }
  }
}

const sequentialPatches = function* (
  dimensions: CandidateDimension[],
  index = 0,
  current: Record<string, unknown> = {},
): Iterable<Record<string, unknown>> {
  if (index === dimensions.length) {
    yield current
    return
  }
  const dimension = dimensions[index]!
  for (let valueIndex = 0; valueIndex < dimension.length; valueIndex += 1) {
    yield* sequentialPatches(dimensions, index + 1, {
      ...current,
      [dimension.path]: dimension.valueAt(valueIndex),
    })
  }
}

export const iterateCandidatePatches = function* (
  dimensions: CandidateDimension[],
  order: GridOrder,
): Iterable<Record<string, unknown>> {
  if (order === 'sequential' || !dimensions.some((dimension) => dimension.kind === 'grid')) {
    yield* sequentialPatches(dimensions)
    return
  }
  const grids = dimensions.filter((dimension) => dimension.kind === 'grid')
  const lists = dimensions.filter((dimension) => dimension.kind === 'list')
  for (const indices of orderedGridIndices(
    grids.map((dimension) => dimension.length),
    grids.map((dimension) => dimension.offset ?? 0),
  )) {
    const gridPatch = Object.fromEntries(
      grids.map((dimension, index) => [dimension.path, dimension.valueAt(indices[index]!)]),
    )
    for (const listPatch of sequentialPatches(lists)) yield { ...gridPatch, ...listPatch }
  }
}
