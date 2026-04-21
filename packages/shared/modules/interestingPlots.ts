export type SimulationData = Record<string, number[]>

export type PlotCandidate =
  | { kind: 'time'; x: string; y: string }
  | { kind: 'xy'; x: string; y: string }

export type PlotFeatures = {
  pearson?: number
  spearman?: number
  mutualInformation?: number
  varianceX?: number
  varianceY?: number
  outlierFraction?: number
  oscillationStrength?: number
  spectralEntropy?: number
  changePointScore?: number
  spikeScore?: number
  hysteresisScore?: number
  complexityScore?: number
  trendScore?: number
  peakCount?: number
}

export type InterestingnessConfig = {
  profile?: 'relationships' | 'dynamics' | 'anomalies' | 'balanced'
  weights?: {
    linearCorrelation?: number
    monotonicRelation?: number
    nonlinearRelation?: number
    oscillation?: number
    spikes?: number
    regimeChange?: number
    outliers?: number
    variance?: number
    hysteresis?: number
    complexity?: number
    trend?: number
  }
  thresholds?: {
    minVariance?: number
    minSamples?: number
    maxFlatFraction?: number
    minScore?: number
  }
  modes?: {
    preferTimeSeries?: boolean
    preferXY?: boolean
    penalizeTrivialLinear?: boolean
    includeNegativeCorrelation?: boolean
    includeConstantSeries?: boolean
  }
}

export type RankedPlot = {
  candidate: PlotCandidate
  score: number
  features: PlotFeatures
  reasons: string[]
}

type ResolvedConfig = {
  profile: NonNullable<InterestingnessConfig['profile']>
  weights: Required<NonNullable<InterestingnessConfig['weights']>>
  thresholds: Required<NonNullable<InterestingnessConfig['thresholds']>>
  modes: Required<NonNullable<InterestingnessConfig['modes']>>
}

export type CandidateGenerationOptions = {
  maxVariablesByVariance?: number
  maxPairs?: number
  includeTimePlots?: boolean
  includeXYPairs?: boolean
  preferredVariables?: string[]
}

const EPS = 1e-12

const DEFAULT_PROFILES: Record<
  NonNullable<InterestingnessConfig['profile']>,
  Required<NonNullable<InterestingnessConfig['weights']>>
> = {
  relationships: {
    linearCorrelation: 0.22,
    monotonicRelation: 0.2,
    nonlinearRelation: 0.22,
    oscillation: 0.02,
    spikes: 0.03,
    regimeChange: 0.03,
    outliers: 0.08,
    variance: 0.07,
    hysteresis: 0.1,
    complexity: 0.02,
    trend: 0.01,
  },
  dynamics: {
    linearCorrelation: 0.05,
    monotonicRelation: 0.06,
    nonlinearRelation: 0.08,
    oscillation: 0.2,
    spikes: 0.14,
    regimeChange: 0.16,
    outliers: 0.1,
    variance: 0.06,
    hysteresis: 0.04,
    complexity: 0.08,
    trend: 0.03,
  },
  anomalies: {
    linearCorrelation: 0.04,
    monotonicRelation: 0.04,
    nonlinearRelation: 0.08,
    oscillation: 0.06,
    spikes: 0.24,
    regimeChange: 0.2,
    outliers: 0.22,
    variance: 0.04,
    hysteresis: 0.03,
    complexity: 0.03,
    trend: 0.02,
  },
  balanced: {
    linearCorrelation: 0.14,
    monotonicRelation: 0.12,
    nonlinearRelation: 0.14,
    oscillation: 0.11,
    spikes: 0.1,
    regimeChange: 0.1,
    outliers: 0.08,
    variance: 0.08,
    hysteresis: 0.06,
    complexity: 0.05,
    trend: 0.02,
  },
}

const DEFAULT_THRESHOLDS: Required<NonNullable<InterestingnessConfig['thresholds']>> = {
  minVariance: 1e-8,
  minSamples: 24,
  maxFlatFraction: 0.92,
  minScore: 0.05,
}

const DEFAULT_MODES: Required<NonNullable<InterestingnessConfig['modes']>> = {
  preferTimeSeries: false,
  preferXY: false,
  penalizeTrivialLinear: true,
  includeNegativeCorrelation: true,
  includeConstantSeries: false,
}

function resolveConfig(config?: InterestingnessConfig): ResolvedConfig {
  const profile = config?.profile ?? 'balanced'
  const profileWeights = DEFAULT_PROFILES[profile]
  return {
    profile,
    weights: {
      ...profileWeights,
      ...(config?.weights ?? {}),
    },
    thresholds: {
      ...DEFAULT_THRESHOLDS,
      ...(config?.thresholds ?? {}),
    },
    modes: {
      ...DEFAULT_MODES,
      ...(config?.modes ?? {}),
    },
  }
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

const mean = (values: number[]): number => {
  if (values.length === 0) return 0
  let total = 0
  for (const v of values) total += v
  return total / values.length
}

const variance = (values: number[]): number => {
  if (values.length < 2) return 0
  const m = mean(values)
  let total = 0
  for (const v of values) {
    const d = v - m
    total += d * d
  }
  return total / (values.length - 1)
}

const stdDev = (values: number[]): number => Math.sqrt(variance(values))

const covariance = (x: number[], y: number[]): number => {
  const n = Math.min(x.length, y.length)
  if (n < 2) return 0
  const mx = mean(x.slice(0, n))
  const my = mean(y.slice(0, n))
  let total = 0
  for (let i = 0; i < n; i += 1) {
    total += (x[i]! - mx) * (y[i]! - my)
  }
  return total / (n - 1)
}

const pearson = (x: number[], y: number[]): number => {
  const sx = stdDev(x)
  const sy = stdDev(y)
  if (sx <= EPS || sy <= EPS) return 0
  return covariance(x, y) / (sx * sy)
}

function rankArray(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }))
  indexed.sort((a, b) => a.v - b.v)
  const out = new Array<number>(values.length)
  for (let i = 0; i < indexed.length; i += 1) {
    let j = i
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j += 1
    const rank = (i + j + 2) / 2
    for (let k = i; k <= j; k += 1) {
      out[indexed[k]!.i] = rank
    }
    i = j
  }
  return out
}

const spearman = (x: number[], y: number[]): number => pearson(rankArray(x), rankArray(y))

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const idx = (sorted.length - 1) * clamp01(q)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  const t = idx - lo
  return sorted[lo]! * (1 - t) + sorted[hi]! * t
}

function median(values: number[]): number {
  return quantile(values, 0.5)
}

function mad(values: number[]): number {
  const m = median(values)
  const dev = values.map((v) => Math.abs(v - m))
  return median(dev)
}

function robustZ(value: number, med: number, madValue: number): number {
  const scale = madValue > EPS ? madValue * 1.4826 : EPS
  return (value - med) / scale
}

function outlierFraction1D(values: number[]): number {
  if (values.length < 5) return 0
  const med = median(values)
  const madValue = mad(values)
  let outliers = 0
  for (const v of values) {
    if (Math.abs(robustZ(v, med, madValue)) > 3.5) outliers += 1
  }
  return outliers / values.length
}

function outlierFraction2D(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 5) return 0
  const xs = x.slice(0, n)
  const ys = y.slice(0, n)
  const mx = median(xs)
  const my = median(ys)
  const madX = mad(xs)
  const madY = mad(ys)
  let outliers = 0
  for (let i = 0; i < n; i += 1) {
    const zx = robustZ(xs[i]!, mx, madX)
    const zy = robustZ(ys[i]!, my, madY)
    if (Math.sqrt(zx * zx + zy * zy) > 3.8) outliers += 1
  }
  return outliers / n
}

function normalizeByVariance(v: number): number {
  return clamp01(v / (v + 1))
}

function mutualInformationBinned(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 16) return 0
  const bins = Math.max(4, Math.min(24, Math.round(Math.sqrt(n / 2))))

  const xMin = Math.min(...x)
  const xMax = Math.max(...x)
  const yMin = Math.min(...y)
  const yMax = Math.max(...y)
  const xSpan = xMax - xMin
  const ySpan = yMax - yMin
  if (xSpan <= EPS || ySpan <= EPS) return 0

  const joint: number[][] = Array.from({ length: bins }, () => Array.from({ length: bins }, () => 0))
  const px = Array.from({ length: bins }, () => 0)
  const py = Array.from({ length: bins }, () => 0)

  for (let i = 0; i < n; i += 1) {
    const xb = Math.min(bins - 1, Math.floor(((x[i]! - xMin) / xSpan) * bins))
    const yb = Math.min(bins - 1, Math.floor(((y[i]! - yMin) / ySpan) * bins))
    joint[xb]![yb]! += 1
    px[xb]! += 1
    py[yb]! += 1
  }

  const invN = 1 / n
  let mi = 0
  let hx = 0
  let hy = 0

  for (let i = 0; i < bins; i += 1) {
    const pxi = px[i]! * invN
    const pyi = py[i]! * invN
    if (pxi > EPS) hx -= pxi * Math.log(pxi)
    if (pyi > EPS) hy -= pyi * Math.log(pyi)

    for (let j = 0; j < bins; j += 1) {
      const pxy = joint[i]![j]! * invN
      if (pxy <= EPS || pxi <= EPS || pyi <= EPS) continue
      mi += pxy * Math.log(pxy / (pxi * pyi))
    }
  }

  const denom = Math.max(EPS, Math.min(hx, hy))
  return clamp01(mi / denom)
}

function countPeaks(values: number[], sigmaThreshold = 1): number {
  if (values.length < 3) return 0
  const m = mean(values)
  const s = stdDev(values)
  if (s <= EPS) return 0
  const minValue = m + sigmaThreshold * s
  let count = 0
  for (let i = 1; i + 1 < values.length; i += 1) {
    const v = values[i]!
    if (v > values[i - 1]! && v >= values[i + 1]! && v > minValue) count += 1
  }
  return count
}

function spikeScore(values: number[]): number {
  const base = outlierFraction1D(values)
  const peaks = countPeaks(values)
  const peakRatio = peaks / Math.max(1, values.length)
  return clamp01(base * 3 + peakRatio * 12)
}

function trendScore(x: number[], y: number[]): number {
  return Math.abs(pearson(x, y))
}

function autocorrelation(values: number[], lag: number): number {
  const n = values.length
  if (lag <= 0 || lag >= n) return 0
  const lhs = values.slice(0, n - lag)
  const rhs = values.slice(lag)
  return pearson(lhs, rhs)
}

function oscillationStrength(values: number[]): number {
  const n = values.length
  if (n < 8) return 0
  const maxLag = Math.min(64, Math.floor(n / 2))
  let best = 0
  for (let lag = 2; lag <= maxLag; lag += 1) {
    const ac = autocorrelation(values, lag)
    if (ac > best) best = ac
  }
  const zeroCrossings = countZeroCrossings(values)
  const zcScore = clamp01(zeroCrossings / Math.max(6, n / 8))
  return clamp01(0.75 * best + 0.25 * zcScore)
}

function countZeroCrossings(values: number[]): number {
  if (values.length < 2) return 0
  const centered = values.map((v) => v - mean(values))
  let crossings = 0
  for (let i = 1; i < centered.length; i += 1) {
    const a = centered[i - 1]!
    const b = centered[i]!
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) crossings += 1
  }
  return crossings
}

function downsample(values: number[], target: number): number[] {
  if (values.length <= target) return values.slice()
  const out: number[] = []
  const step = values.length / target
  for (let i = 0; i < target; i += 1) {
    out.push(values[Math.floor(i * step)]!)
  }
  return out
}

function spectralEntropy(values: number[]): number {
  const sampled = downsample(values, 256)
  const n = sampled.length
  if (n < 16) return 0

  const centered = sampled.map((v) => v - mean(sampled))
  const half = Math.floor(n / 2)
  const power: number[] = []

  for (let k = 1; k <= half; k += 1) {
    let re = 0
    let im = 0
    for (let t = 0; t < n; t += 1) {
      const angle = (2 * Math.PI * k * t) / n
      re += centered[t]! * Math.cos(angle)
      im -= centered[t]! * Math.sin(angle)
    }
    power.push(re * re + im * im)
  }

  const total = power.reduce((acc, p) => acc + p, 0)
  if (total <= EPS) return 0
  const probs = power.map((p) => p / total)
  let h = 0
  for (const p of probs) {
    if (p > EPS) h -= p * Math.log(p)
  }
  return clamp01(h / Math.log(probs.length + EPS))
}

function complexityScore(values: number[]): number {
  const entropy = spectralEntropy(values)
  const lag1 = Math.abs(autocorrelation(values, 1))
  return clamp01(entropy * (1 - lag1))
}

function changePointScore(values: number[]): number {
  const n = values.length
  if (n < 20) return 0

  const minSegment = Math.max(6, Math.floor(n * 0.1))
  let best = 0

  for (let split = minSegment; split <= n - minSegment; split += 1) {
    const left = values.slice(0, split)
    const right = values.slice(split)

    const meanShift = Math.abs(mean(left) - mean(right))
    const scale = stdDev(values) + EPS

    const leftVar = variance(left)
    const rightVar = variance(right)
    const varShift = Math.abs(leftVar - rightVar) / (leftVar + rightVar + EPS)

    const score = 0.7 * clamp01(meanShift / (2.2 * scale)) + 0.3 * clamp01(varShift)
    if (score > best) best = score
  }

  return best
}

function hysteresisScore(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 20) return 0
  const xs = x.slice(0, n)
  const ys = y.slice(0, n)
  const yStd = stdDev(ys)
  if (yStd <= EPS) return 0

  const bins = Math.max(6, Math.min(24, Math.round(Math.sqrt(n))))
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const span = xMax - xMin
  if (span <= EPS) return 0

  const grouped: number[][] = Array.from({ length: bins }, () => [])
  for (let i = 0; i < n; i += 1) {
    const b = Math.min(bins - 1, Math.floor(((xs[i]! - xMin) / span) * bins))
    grouped[b]!.push(ys[i]!)
  }

  let multiValued = 0
  let used = 0
  for (const binValues of grouped) {
    if (binValues.length < 4) continue
    const localStd = stdDev(binValues)
    multiValued += clamp01(localStd / (yStd + EPS))
    used += 1
  }
  const multiValueScore = used > 0 ? multiValued / used : 0

  let turnCount = 0
  for (let i = 2; i < n; i += 1) {
    const dx1 = xs[i - 1]! - xs[i - 2]!
    const dy1 = ys[i - 1]! - ys[i - 2]!
    const dx2 = xs[i]! - xs[i - 1]!
    const dy2 = ys[i]! - ys[i - 1]!
    const cross = dx1 * dy2 - dy1 * dx2
    if (Math.abs(cross) > EPS) turnCount += 1
  }
  const turnScore = clamp01(turnCount / Math.max(1, n * 0.6))

  return clamp01(0.7 * multiValueScore + 0.3 * turnScore)
}

function finiteAlignedSeries(data: SimulationData, xPath: string, yPath: string): { x: number[]; y: number[] } {
  const xRaw = data[xPath] ?? []
  const yRaw = data[yPath] ?? []
  const n = Math.min(xRaw.length, yRaw.length)
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < n; i += 1) {
    const xv = xRaw[i]
    const yv = yRaw[i]
    if (typeof xv !== 'number' || typeof yv !== 'number') continue
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue
    x.push(xv)
    y.push(yv)
  }
  return { x, y }
}

export function extractFeatures(
  data: SimulationData,
  candidate: PlotCandidate,
  config?: InterestingnessConfig,
): PlotFeatures {
  const resolved = resolveConfig(config)
  const { x, y } = finiteAlignedSeries(data, candidate.x, candidate.y)
  const features: PlotFeatures = {
    varianceX: variance(x),
    varianceY: variance(y),
  }

  if (x.length < resolved.thresholds.minSamples) return features

  if (candidate.kind === 'xy') {
    const p = pearson(x, y)
    const s = spearman(x, y)
    const mi = mutualInformationBinned(x, y)
    features.pearson = p
    features.spearman = s
    features.mutualInformation = mi
    features.outlierFraction = outlierFraction2D(x, y)
    features.hysteresisScore = hysteresisScore(x, y)

    // For xy, complexity here tracks non-trivial departure from pure linearity.
    features.complexityScore = clamp01(mi * (1 - Math.abs(p)))
    return features
  }

  const p = pearson(x, y)
  features.pearson = p
  features.trendScore = trendScore(x, y)
  features.outlierFraction = outlierFraction1D(y)
  features.peakCount = countPeaks(y)
  features.spikeScore = spikeScore(y)
  features.oscillationStrength = oscillationStrength(y)
  features.changePointScore = changePointScore(y)
  features.spectralEntropy = spectralEntropy(y)
  features.complexityScore = complexityScore(y)
  return features
}

function normalizedContribution(
  features: PlotFeatures,
  config?: InterestingnessConfig,
): Required<NonNullable<InterestingnessConfig['weights']>> {
  const resolved = resolveConfig(config)
  const absPearson = Math.abs(features.pearson ?? 0)
  const absSpearman = Math.abs(features.spearman ?? 0)
  const signedPearson = resolved.modes.includeNegativeCorrelation
    ? absPearson
    : Math.max(0, features.pearson ?? 0)
  const signedSpearman = resolved.modes.includeNegativeCorrelation
    ? absSpearman
    : Math.max(0, features.spearman ?? 0)
  const mi = clamp01(features.mutualInformation ?? 0)

  const varianceScore = normalizeByVariance((features.varianceX ?? 0) + (features.varianceY ?? 0))
  const nonlinearScore = clamp01(mi * (0.6 + 0.4 * (1 - absPearson)))

  return {
    linearCorrelation: signedPearson,
    monotonicRelation: signedSpearman,
    nonlinearRelation: nonlinearScore,
    oscillation: clamp01(features.oscillationStrength ?? 0),
    spikes: clamp01(features.spikeScore ?? 0),
    regimeChange: clamp01(features.changePointScore ?? 0),
    outliers: clamp01((features.outlierFraction ?? 0) * 3),
    variance: varianceScore,
    hysteresis: clamp01(features.hysteresisScore ?? 0),
    complexity: clamp01((features.complexityScore ?? features.spectralEntropy ?? 0) * 1),
    trend: clamp01(features.trendScore ?? 0),
  }
}

function computePenalty(
  features: PlotFeatures,
  candidate: PlotCandidate,
  config?: InterestingnessConfig,
): number {
  const resolved = resolveConfig(config)

  let penalty = 0

  const lowVariance = (features.varianceY ?? 0) < resolved.thresholds.minVariance
  if (lowVariance && !resolved.modes.includeConstantSeries) penalty += 0.28

  if (candidate.kind === 'time') {
    const yFlat = flatFractionFromVariance(features.varianceY ?? 0)
    if (yFlat > resolved.thresholds.maxFlatFraction) penalty += 0.15
  }

  if (candidate.kind === 'xy' && resolved.modes.penalizeTrivialLinear) {
    const absP = Math.abs(features.pearson ?? 0)
    const mi = features.mutualInformation ?? 0
    if (absP > 0.985 && mi < 0.2) penalty += 0.18
  }

  if (resolved.modes.preferTimeSeries && candidate.kind !== 'time') penalty += 0.06
  if (resolved.modes.preferXY && candidate.kind !== 'xy') penalty += 0.06

  return penalty
}

function flatFractionFromVariance(v: number): number {
  if (v <= EPS) return 1
  return clamp01(1 / (1 + v * 200))
}

export function scorePlot(
  features: PlotFeatures,
  candidate: PlotCandidate,
  config?: InterestingnessConfig,
): number {
  const resolved = resolveConfig(config)
  const contributions = normalizedContribution(features, resolved)

  let score = 0
  let totalWeight = 0
  for (const key of Object.keys(resolved.weights) as Array<keyof typeof resolved.weights>) {
    const w = resolved.weights[key]
    const c = contributions[key]
    score += w * c
    totalWeight += w
  }

  score = totalWeight > EPS ? score / totalWeight : 0
  score -= computePenalty(features, candidate, resolved)
  return clamp01(score)
}

export function explainPlot(
  features: PlotFeatures,
  candidate: PlotCandidate,
  config?: InterestingnessConfig,
): string[] {
  const resolved = resolveConfig(config)
  const reasons: string[] = []

  const p = features.pearson ?? 0
  const s = features.spearman ?? 0
  const absP = Math.abs(p)
  const absS = Math.abs(s)
  const mi = features.mutualInformation ?? 0

  if (absP > 0.85) reasons.push('strong linear relationship')
  if (absS > 0.85 && absP < 0.65) reasons.push('strong monotonic but nonlinear relationship')
  if (mi > 0.45 && absP < 0.75) reasons.push('nonlinear dependency')

  if ((features.oscillationStrength ?? 0) > 0.55) reasons.push('clear oscillatory behavior')
  if ((features.spikeScore ?? 0) > 0.35 || (features.outlierFraction ?? 0) > 0.04)
    reasons.push('contains spikes/outliers')
  if ((features.changePointScore ?? 0) > 0.45) reasons.push('possible regime change')
  if ((features.hysteresisScore ?? 0) > 0.45) reasons.push('phase-loop / hysteresis-like structure')
  if ((features.complexityScore ?? 0) > 0.55) reasons.push('high irregularity/complexity')

  if ((features.varianceY ?? 0) < resolved.thresholds.minVariance && !resolved.modes.includeConstantSeries) {
    reasons.push('very low variance (penalized)')
  }

  if (candidate.kind === 'xy' && resolved.modes.penalizeTrivialLinear && absP > 0.985 && mi < 0.2) {
    reasons.push('near-trivial linear relation (penalized)')
  }

  if (reasons.length === 0) reasons.push('moderate mixed signals across metrics')
  return reasons
}

function seriesVarianceMap(data: SimulationData): Array<{ key: string; variance: number; samples: number }> {
  return Object.entries(data)
    .filter(([, arr]) => Array.isArray(arr) && arr.length > 1)
    .map(([key, arr]) => {
      const clean = arr.filter((v) => Number.isFinite(v))
      return { key, variance: variance(clean), samples: clean.length }
    })
}

function findTimeKey(data: SimulationData): string | null {
  const keys = Object.keys(data)
  const exactCandidates = ['t', 'time', 'data.t', 'data.time']
  for (const k of exactCandidates) {
    if (keys.includes(k)) return k
  }
  const fuzzy = keys.find((k) => /(?:^|\.)(t|time)$/i.test(k))
  return fuzzy ?? null
}

export function generateDefaultCandidates(
  data: SimulationData,
  options?: CandidateGenerationOptions,
): PlotCandidate[] {
  const maxVariablesByVariance = options?.maxVariablesByVariance ?? 12
  const maxPairs = options?.maxPairs ?? 40
  const includeTimePlots = options?.includeTimePlots ?? true
  const includeXYPairs = options?.includeXYPairs ?? true
  const preferred = new Set(options?.preferredVariables ?? [])

  const candidates: PlotCandidate[] = []
  const rankedVars = seriesVarianceMap(data)
    .filter((entry) => entry.samples >= 8)
    .sort((a, b) => b.variance - a.variance)

  const selected: string[] = []
  for (const key of preferred) {
    if (data[key] && !selected.includes(key)) selected.push(key)
  }
  for (const entry of rankedVars) {
    if (selected.length >= maxVariablesByVariance) break
    if (!selected.includes(entry.key)) selected.push(entry.key)
  }

  const tKey = findTimeKey(data)
  if (includeTimePlots && tKey) {
    for (const key of selected) {
      if (key === tKey) continue
      candidates.push({ kind: 'time', x: tKey, y: key })
    }
  }

  if (includeXYPairs) {
    const varsForPairs = selected.filter((k) => k !== tKey)
    let pairCount = 0
    for (let i = 0; i < varsForPairs.length; i += 1) {
      for (let j = i + 1; j < varsForPairs.length; j += 1) {
        if (pairCount >= maxPairs) break
        candidates.push({ kind: 'xy', x: varsForPairs[i]!, y: varsForPairs[j]! })
        pairCount += 1
      }
      if (pairCount >= maxPairs) break
    }
  }

  return candidates
}

export function rankInterestingPlots(
  data: SimulationData,
  candidates?: PlotCandidate[],
  config?: InterestingnessConfig,
): RankedPlot[] {
  const resolved = resolveConfig(config)
  const candidateList = candidates ?? generateDefaultCandidates(data)
  const ranked: RankedPlot[] = []

  for (const candidate of candidateList) {
    const pair = finiteAlignedSeries(data, candidate.x, candidate.y)
    if (pair.x.length < Math.max(4, resolved.thresholds.minSamples)) continue

    const features = extractFeatures(data, candidate, resolved)
    const rawScore = scorePlot(features, candidate, resolved)
    if (rawScore < resolved.thresholds.minScore) continue

    ranked.push({
      candidate,
      score: rawScore,
      features,
      reasons: explainPlot(features, candidate, resolved),
    })
  }

  return ranked.sort((a, b) => b.score - a.score)
}

export function buildSyntheticDemoData(length = 320): SimulationData {
  const t = Array.from({ length }, (_, i) => i / 10)
  const noise = (scale: number) => (Math.random() * 2 - 1) * scale

  const linear = t.map((v) => 2.2 * v + noise(0.6))
  const monoNonlinear = t.map((v) => Math.log1p(v * 4) + noise(0.08))
  const sinusoid = t.map((v) => Math.sin(v * 1.8) + noise(0.08))
  const spiky = t.map((v, i) => {
    const base = 0.2 * Math.sin(v * 0.8) + noise(0.07)
    return i % 41 === 0 ? base + 3.5 : base
  })
  const regimeShift = t.map((v, i) => (i < length / 2 ? Math.sin(v) : 1.6 + Math.sin(v * 0.45)) + noise(0.09))
  const irregular = t.map((v, i) => {
    const drift = i > length * 0.65 ? 0.7 : 0
    return Math.sin(v * 1.1) + 0.5 * Math.sin(v * 3.7) + drift + noise(0.35)
  })

  const theta = t.map((v) => v * 0.7)
  const loopX = theta.map((th) => Math.sin(th) + noise(0.03))
  const loopY = theta.map((th, i) => Math.sin(th - Math.PI / 2) + 0.28 * Math.sin(theta[i]! * 2) + noise(0.03))

  return {
    t,
    linear,
    monoNonlinear,
    sinusoid,
    spiky,
    regimeShift,
    irregular,
    loopX,
    loopY,
  }
}

export function demoRankInterestingPlots(
  config?: InterestingnessConfig,
): Array<Pick<RankedPlot, 'candidate' | 'score' | 'reasons'>> {
  const ranked = rankInterestingPlots(buildSyntheticDemoData(), undefined, config)
  return ranked.slice(0, 8).map((entry) => ({
    candidate: entry.candidate,
    score: Number(entry.score.toFixed(3)),
    reasons: entry.reasons,
  }))
}
