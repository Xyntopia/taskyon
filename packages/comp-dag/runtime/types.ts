export type FlattenRunInput = {
  params?: unknown
  outputs?: unknown
}

export type FlattenInput = {
  runs: FlattenRunInput[]
  options?:
    | {
        includePrefixes?: boolean | undefined
      }
    | undefined
}

export type FlattenOutput = {
  rows: Array<Record<string, unknown>>
  rowCount: number
  keyCount: number
}

export type ColumnStats = {
  rowsSeen: number
  presentCount: number
  nullCount: number
  undefinedCount: number
  nonNullCount: number
  informativeCount: number
  constantLikeCount: number
  distinctValueCount: number
  allPresentValuesConstant: boolean
  typeCounts: Record<string, number>
  alwaysNullish: boolean
  nullishRate: number
  presenceRate: number
}

