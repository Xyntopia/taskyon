import type { ObjectPathChartDefinition } from './ObjectPathChartAxesEditor.vue'

export type ResolverChartVariant = 'plot' | 'map'

export type ResolverPayload = {
  plotValue?: unknown
  mapValue?: unknown
  tableData?: {
    columns: string[]
    rows: Array<Record<string, unknown>>
  }
  error?: string
}

export type ResolvePayloadInput = {
  variant: ResolverChartVariant
  chart: ObjectPathChartDefinition
  index: number
  buildPlotPayload: () => ResolverPayload
  buildMapPayload: () => ResolverPayload
  plotPayloadResolver?: ((args: { chart: ObjectPathChartDefinition; index: number }) => ResolverPayload | Promise<ResolverPayload>) | null
  mapPayloadResolver?: ((args: { chart: ObjectPathChartDefinition; index: number }) => ResolverPayload | Promise<ResolverPayload>) | null
}

export const resolveObjectPathChartPayload = async (
  input: ResolvePayloadInput,
): Promise<ResolverPayload> => {
  if (input.variant === 'map') {
    if (typeof input.mapPayloadResolver === 'function') {
      return input.mapPayloadResolver({ chart: input.chart, index: input.index })
    }
    return input.buildMapPayload()
  }

  if (typeof input.plotPayloadResolver === 'function') {
    return input.plotPayloadResolver({ chart: input.chart, index: input.index })
  }
  return input.buildPlotPayload()
}

export const normalizeResolvedChartPayload = (
  variant: ResolverChartVariant,
  payload: ResolverPayload,
): ResolverPayload => {
  const hasPayloadData = variant === 'plot' ? payload.plotValue !== undefined : payload.mapValue !== undefined
  if (hasPayloadData || payload.error) return payload
  return {
    ...payload,
    error:
      variant === 'plot'
        ? 'No chart data could be resolved for the selected axes.'
        : 'No map data could be resolved for the selected configuration.',
  }
}
