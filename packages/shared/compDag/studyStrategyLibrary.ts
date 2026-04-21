import {
  createNearestByLatLonStudyStrategy,
  createSequentialStudyStrategy,
  type StudyInputStrategy,
} from './dagCore'

export type StudyStrategyFactoryArgs = Record<string, unknown> | undefined

export type StudyStrategyDefinition = {
  id: string
  label: string
  description: string
  create: (args?: StudyStrategyFactoryArgs) => StudyInputStrategy
}

const asNumber = (v: unknown): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v
}

const asString = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || v.length === 0) return undefined
  return v
}

const clamp01 = (v: number | undefined, fallback: number): number => {
  if (v === undefined) return fallback
  return Math.min(1, Math.max(0, v))
}

export const createHotspotEpsilonGreedyStudyStrategy = (
  args?: StudyStrategyFactoryArgs,
): StudyInputStrategy => {
  const latPath = asString(args?.latPath) ?? 'centerLat'
  const lonPath = asString(args?.lonPath) ?? 'centerLon'
  const randomFraction = clamp01(asNumber(args?.randomFraction), 0.1)

  return (ctx) => {
    const remaining = [...ctx.remainingIndices]
    if (remaining.length <= 1) return remaining

    // Epsilon-greedy: randomly explore a small fraction of candidates.
    if (ctx.random() < randomFraction) {
      const randomIndex = Math.floor(ctx.random() * remaining.length)
      const picked = remaining[randomIndex]!
      return [picked, ...remaining.filter((i) => i !== picked)]
    }

    // Otherwise exploit around the best objective seen so far.
    const bestHistory = [...ctx.history]
      .filter((h) => h.objectiveValue !== null)
      .sort((a, b) => (b.objectiveValue as number) - (a.objectiveValue as number))[0]
    const anchorIndex = bestHistory?.sourceIndexByAlias[ctx.alias] ?? remaining[0]!

    const lat0 = Number(ctx.getCandidateValue(anchorIndex, latPath))
    const lon0 = Number(ctx.getCandidateValue(anchorIndex, lonPath))
    if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) return remaining

    return remaining.sort((a, b) => {
      const latA = Number(ctx.getCandidateValue(a, latPath))
      const lonA = Number(ctx.getCandidateValue(a, lonPath))
      const latB = Number(ctx.getCandidateValue(b, latPath))
      const lonB = Number(ctx.getCandidateValue(b, lonPath))
      const dA =
        Number.isFinite(latA) && Number.isFinite(lonA)
          ? (latA - lat0) ** 2 + (lonA - lon0) ** 2
          : Number.POSITIVE_INFINITY
      const dB =
        Number.isFinite(latB) && Number.isFinite(lonB)
          ? (latB - lat0) ** 2 + (lonB - lon0) ** 2
          : Number.POSITIVE_INFINITY
      return dA - dB
    })
  }
}

export const studyStrategyLibrary: StudyStrategyDefinition[] = [
  {
    id: 'sequential',
    label: 'Sequential',
    description:
      'Baseline strategy. Evaluates exploded candidates in their current order without re-ranking.',
    create: () => createSequentialStudyStrategy(),
  },
  {
    id: 'nearestByLatLon',
    label: 'Nearest By Lat/Lon',
    description:
      'Exploits around the best objective seen so far by prioritizing spatially nearby candidates. Good for smooth geo-spatial objective surfaces.',
    create: (args) =>
      createNearestByLatLonStudyStrategy({
        latPath: asString(args?.latPath) ?? 'centerLat',
        lonPath: asString(args?.lonPath) ?? 'centerLon',
        randomFraction: clamp01(asNumber(args?.randomFraction), 0),
      }),
  },
  {
    id: 'hotspotEpsilonGreedy',
    label: 'Hotspot Epsilon-Greedy',
    description:
      'Balances exploration and exploitation: randomly samples a small fraction, otherwise focuses near the best-known hotspot. Useful when local maxima are expected.',
    create: createHotspotEpsilonGreedyStudyStrategy,
  },
]

export const getStudyStrategyDefinition = (
  id: string | null | undefined,
): StudyStrategyDefinition | null => {
  if (!id) return null
  return studyStrategyLibrary.find((s) => s.id === id) ?? null
}

export const createStudyInputStrategyFromSelection = (selection?: {
  id?: string
  args?: Record<string, unknown>
}): StudyInputStrategy => {
  const def = getStudyStrategyDefinition(selection?.id)
  if (!def) return createSequentialStudyStrategy()
  return def.create(selection?.args)
}
