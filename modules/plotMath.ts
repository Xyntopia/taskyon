export type PlotFlatRow = Record<string, unknown>

export type PlotSparseHeatmapValue = {
  kind: 'xyv-heatmap'
  xValues: number[]
  yValues: number[]
  xLabels?: string[]
  yLabels?: string[]
  points: Array<{ x: number; y: number; v: number }>
}
export type PlotResolution = 'auto' | number
export type PlotContourInterpolationMethod =
  | 'optuna-poisson'
  | 'neighbor-average'
  | 'nearest-expand'
  | 'distance-average'
export type PlotSparseHeatmapRenderMode = 'heatmap' | 'contour' | 'auto'

export type PlotSparseHeatmapChartData = {
  xValues: number[]
  yValues: number[]
  data: Array<[number, number, number]>
  fillRatio: number
  usedContour: boolean
  contourMethod: PlotContourInterpolationMethod | null
}

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)))

const linspace = (min: number, max: number, count: number): number[] => {
  if (count <= 1 || max <= min) return [min]
  const step = (max - min) / (count - 1)
  return Array.from({ length: count }, (_, i) => min + i * step)
}

const toFiniteNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const safeToString = (v: unknown): string => {
  if (v === null || v === undefined) return String(v)
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return `${v as string | number | boolean}`
}

const sortCategoryValues = (values: unknown[]): string[] => {
  const asStrings = Array.from(new Set(values.map((v) => String(v))))
  const allNumeric = asStrings.every((s) => {
    const n = Number(s)
    return Number.isFinite(n)
  })
  if (allNumeric) {
    return asStrings.sort((a, b) => Number(a) - Number(b))
  }
  return asStrings.sort((a, b) => a.localeCompare(b))
}

const keyNum = (n: number): string => n.toPrecision(14)
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

const uniqueSortedFinite = (values: number[]): number[] =>
  Array.from(new Set(values.filter((v) => Number.isFinite(v))))
    .sort((a, b) => a - b)

const neighborOffsets8: Array<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const

const neighborOffsets4: Array<readonly [number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const

const inBounds = (x: number, y: number, w: number, h: number): boolean =>
  x >= 0 && y >= 0 && x < w && y < h

const matrixFromSparsePoints = (
  xValues: number[],
  yValues: number[],
  points: Array<{ x: number; y: number; v: number }>,
): { matrix: Array<Array<number | null>>; fillRatio: number } => {
  const width = xValues.length
  const height = yValues.length
  const matrix: Array<Array<number | null>> = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => null),
  )
  if (width === 0 || height === 0) return { matrix, fillRatio: 0 }

  const xIndex = new Map(xValues.map((x, i) => [keyNum(x), i]))
  const yIndex = new Map(yValues.map((y, i) => [keyNum(y), i]))
  const sum: number[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => 0))
  const count: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0),
  )

  for (const p of points) {
    const xi = xIndex.get(keyNum(p.x))
    const yi = yIndex.get(keyNum(p.y))
    if (xi == null || yi == null || !Number.isFinite(p.v)) continue
    sum[yi]![xi]! += p.v
    count[yi]![xi]! += 1
  }

  let known = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const c = count[y]![x]!
      if (c > 0) {
        matrix[y]![x] = sum[y]![x]! / c
        known += 1
      }
    }
  }

  return { matrix, fillRatio: known / Math.max(1, width * height) }
}

const matrixToIndexedData = (matrix: Array<Array<number | null>>): Array<[number, number, number]> => {
  const out: Array<[number, number, number]> = []
  for (let y = 0; y < matrix.length; y += 1) {
    const row = matrix[y]!
    for (let x = 0; x < row.length; x += 1) {
      const v = row[x]
      if (v == null || !Number.isFinite(v)) continue
      out.push([x, y, v])
    }
  }
  return out
}

const cloneMatrix = (matrix: Array<Array<number | null>>): Array<Array<number | null>> =>
  matrix.map((row) => row.slice())

const fillNearestExpand = (matrixIn: Array<Array<number | null>>): Array<Array<number | null>> => {
  const matrix = cloneMatrix(matrixIn)
  const h = matrix.length
  const w = h > 0 ? matrix[0]!.length : 0
  const queue: Array<[number, number]> = []

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (matrix[y]![x] != null) queue.push([x, y])
    }
  }

  let qHead = 0
  while (qHead < queue.length) {
    const [x, y] = queue[qHead++]!
    const v = matrix[y]![x]
    if (v == null) continue
    for (const [dx, dy] of neighborOffsets8) {
      const nx = x + dx
      const ny = y + dy
      if (!inBounds(nx, ny, w, h)) continue
      if (matrix[ny]![nx] != null) continue
      matrix[ny]![nx] = v
      queue.push([nx, ny])
    }
  }

  return matrix
}

const fillNeighborAverage = (matrixIn: Array<Array<number | null>>): Array<Array<number | null>> => {
  const matrix = cloneMatrix(matrixIn)
  const h = matrix.length
  const w = h > 0 ? matrix[0]!.length : 0
  const inQueue = new Set<string>()
  const queue: Array<[number, number]> = []
  const push = (x: number, y: number) => {
    const key = `${x}:${y}`
    if (inQueue.has(key)) return
    inQueue.add(key)
    queue.push([x, y])
  }

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (matrix[y]![x] != null) {
        for (const [dx, dy] of neighborOffsets8) {
          const nx = x + dx
          const ny = y + dy
          if (inBounds(nx, ny, w, h) && matrix[ny]![nx] == null) push(nx, ny)
        }
      }
    }
  }

  let qHead = 0
  while (qHead < queue.length) {
    const [x, y] = queue[qHead++]!
    if (matrix[y]![x] != null) continue
    let sum = 0
    let count = 0
    for (const [dx, dy] of neighborOffsets8) {
      const nx = x + dx
      const ny = y + dy
      if (!inBounds(nx, ny, w, h)) continue
      const v = matrix[ny]![nx]
      if (v == null) continue
      sum += v
      count += 1
    }
    if (count === 0) continue
    matrix[y]![x] = sum / count
    for (const [dx, dy] of neighborOffsets8) {
      const nx = x + dx
      const ny = y + dy
      if (inBounds(nx, ny, w, h) && matrix[ny]![nx] == null) push(nx, ny)
    }
  }

  return matrix
}

const fillDistanceAverage = (matrixIn: Array<Array<number | null>>): Array<Array<number | null>> => {
  const matrix = cloneMatrix(matrixIn)
  const h = matrix.length
  const w = h > 0 ? matrix[0]!.length : 0
  const known: Array<{ x: number; y: number; v: number }> = []

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = matrix[y]![x]
      if (v != null) known.push({ x, y, v })
    }
  }
  if (known.length === 0) return matrix

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (matrix[y]![x] != null) continue
      let wSum = 0
      let zvSum = 0
      for (const k of known) {
        const dx = x - k.x
        const dy = y - k.y
        const d = Math.sqrt(dx * dx + dy * dy)
        const wgt = 1 / (d + 1e-6)
        wSum += wgt
        zvSum += wgt * k.v
      }
      if (wSum > 0) matrix[y]![x] = zvSum / wSum
    }
  }

  return matrix
}

const fillOptunaPoisson = (
  matrixIn: Array<Array<number | null>>,
  maxIterations = 300,
  tolerance = 1e-4,
): Array<Array<number | null>> => {
  const matrix = cloneMatrix(matrixIn)
  const h = matrix.length
  const w = h > 0 ? matrix[0]!.length : 0
  if (h === 0 || w === 0) return matrix

  const isKnown: boolean[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => false))
  const knownValues: number[] = []
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = matrix[y]![x]
      if (v != null && Number.isFinite(v)) {
        isKnown[y]![x] = true
        knownValues.push(v)
      }
    }
  }
  if (knownValues.length === 0) return matrix

  const mean = knownValues.reduce((s, v) => s + v, 0) / knownValues.length
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!isKnown[y]![x] && matrix[y]![x] == null) matrix[y]![x] = mean
    }
  }

  for (let iter = 0; iter < maxIterations; iter += 1) {
    let maxDelta = 0
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (isKnown[y]![x]) continue
        let sum = 0
        let count = 0
        for (const [dx, dy] of neighborOffsets4) {
          const nx = x + dx
          const ny = y + dy
          if (!inBounds(nx, ny, w, h)) continue
          const nv = matrix[ny]![nx]
          if (nv == null) continue
          sum += nv
          count += 1
        }
        if (count === 0) continue
        const prev = matrix[y]![x] ?? mean
        const next = sum / count
        matrix[y]![x] = next
        const delta = Math.abs(next - prev)
        if (delta > maxDelta) maxDelta = delta
      }
    }
    if (maxDelta < tolerance) break
  }

  return matrix
}

const buildContourGrid = (
  payload: PlotSparseHeatmapValue,
  resolution: PlotResolution,
): {
  xValues: number[]
  yValues: number[]
  matrix: Array<Array<number | null>>
} | null => {
  const finitePoints = payload.points
    .map((p) => ({ x: Number(p.x), y: Number(p.y), v: Number(p.v) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.v))
  if (finitePoints.length === 0) return null

  const xMin = Math.min(...finitePoints.map((p) => p.x))
  const xMax = Math.max(...finitePoints.map((p) => p.x))
  const yMin = Math.min(...finitePoints.map((p) => p.y))
  const yMax = Math.max(...finitePoints.map((p) => p.y))

  const baseResolution =
    resolution === 'auto' || resolution == null
      ? clampInt(Math.sqrt(finitePoints.length) * 2, 24, 72)
      : clampInt(resolution, 4, 128)
  const xCount = xMax > xMin ? baseResolution : 1
  const yCount = yMax > yMin ? baseResolution : 1
  const xValues = linspace(xMin, xMax, xCount)
  const yValues = linspace(yMin, yMax, yCount)

  const sum: number[][] = Array.from({ length: yCount }, () => Array.from({ length: xCount }, () => 0))
  const count: number[][] = Array.from({ length: yCount }, () =>
    Array.from({ length: xCount }, () => 0),
  )

  for (const p of finitePoints) {
    const xi =
      xCount === 1
        ? 0
        : clampInt(clamp01((p.x - xMin) / Math.max(1e-12, xMax - xMin)) * (xCount - 1), 0, xCount - 1)
    const yi =
      yCount === 1
        ? 0
        : clampInt(clamp01((p.y - yMin) / Math.max(1e-12, yMax - yMin)) * (yCount - 1), 0, yCount - 1)
    sum[yi]![xi]! += p.v
    count[yi]![xi]! += 1
  }

  const matrix: Array<Array<number | null>> = Array.from({ length: yCount }, (_, y) =>
    Array.from({ length: xCount }, (_, x) => {
      const c = count[y]![x]!
      return c > 0 ? sum[y]![x]! / c : null
    }),
  )

  return { xValues, yValues, matrix }
}

export const buildSparseHeatmapChartData = (
  payload: PlotSparseHeatmapValue,
  opts?: {
    renderMode?: PlotSparseHeatmapRenderMode
    autoContourOnSparseHeatmap?: boolean
    autoContourThreshold?: number
    contourMethod?: PlotContourInterpolationMethod
    contourResolution?: PlotResolution
  },
): PlotSparseHeatmapChartData => {
  const finitePointPayload = {
    ...payload,
    xValues: uniqueSortedFinite(payload.xValues.map((v) => Number(v))),
    yValues: uniqueSortedFinite(payload.yValues.map((v) => Number(v))),
    points: payload.points
      .map((p) => ({ x: Number(p.x), y: Number(p.y), v: Number(p.v) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.v)),
  }

  const fallbackX = uniqueSortedFinite(finitePointPayload.points.map((p) => p.x))
  const fallbackY = uniqueSortedFinite(finitePointPayload.points.map((p) => p.y))
  const rawX = finitePointPayload.xValues.length > 0 ? finitePointPayload.xValues : fallbackX
  const rawY = finitePointPayload.yValues.length > 0 ? finitePointPayload.yValues : fallbackY
  const raw = matrixFromSparsePoints(rawX, rawY, finitePointPayload.points)

  const renderMode =
    opts?.renderMode ?? (opts?.autoContourOnSparseHeatmap === true ? 'auto' : 'heatmap')
  const threshold = opts?.autoContourThreshold ?? 0.45
  const shouldUseContour =
    renderMode === 'contour' || (renderMode === 'auto' && raw.fillRatio > 0 && raw.fillRatio < threshold)

  if (!shouldUseContour) {
    return {
      xValues: rawX,
      yValues: rawY,
      data: matrixToIndexedData(raw.matrix),
      fillRatio: raw.fillRatio,
      usedContour: false,
      contourMethod: null,
    }
  }

  const contourMethod = opts?.contourMethod ?? 'optuna-poisson'
  const contourResolution = opts?.contourResolution ?? 'auto'
  const dense = buildContourGrid(finitePointPayload, contourResolution)
  if (!dense) {
    return {
      xValues: rawX,
      yValues: rawY,
      data: matrixToIndexedData(raw.matrix),
      fillRatio: raw.fillRatio,
      usedContour: false,
      contourMethod: null,
    }
  }

  const filled =
    contourMethod === 'nearest-expand'
      ? fillNearestExpand(dense.matrix)
      : contourMethod === 'neighbor-average'
        ? fillNeighborAverage(dense.matrix)
        : contourMethod === 'distance-average'
          ? fillDistanceAverage(dense.matrix)
          : fillOptunaPoisson(dense.matrix)

  return {
    xValues: dense.xValues,
    yValues: dense.yValues,
    data: matrixToIndexedData(filled),
    fillRatio: raw.fillRatio,
    usedContour: true,
    contourMethod,
  }
}

export const flattenForPlot = (value: unknown, prefix: string, out: PlotFlatRow) => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, child] of Object.entries(value as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${k}` : k
      flattenForPlot(child, next, out)
    }
    return
  }
  out[prefix] = value
}

export const runToPlotFlatRow = (run: Record<string, unknown>, runIndex: number): PlotFlatRow => {
  const out: PlotFlatRow = { runIndex }
  flattenForPlot(run, '', out)
  return out
}

export const buildPlotValueFromRows = (
  rows: PlotFlatRow[],
  xPath: string | null,
  yPath: string | null,
  vPath: string | null,
  opts?: { resolution?: PlotResolution },
): unknown[] | number[][] | PlotSparseHeatmapValue | null => {
  if (!yPath) return null
  if (rows.length === 0) return null

  const getNum = (row: PlotFlatRow, path: string): number | null => {
    const v = row[path]
    return toFiniteNumber(v)
  }

  if (!xPath) {
    const y = rows.map((r) => getNum(r, yPath)).filter((v): v is number => v != null)
    return y.length > 0 ? y : null
  }

  if (!vPath) {
    const buckets = new Map<string, { sum: number; count: number }>()
    for (const row of rows) {
      const xRaw = row[xPath]
      const y = getNum(row, yPath)
      if (xRaw == null || y == null) continue
      const key = safeToString(xRaw)
      const bucket = buckets.get(key)
      if (!bucket) buckets.set(key, { sum: y, count: 1 })
      else {
        bucket.sum += y
        bucket.count += 1
      }
    }

    const orderedX = sortCategoryValues(Array.from(buckets.keys()))
    const series = orderedX
      .map((x) => {
        const b = buckets.get(x)
        return b && b.count > 0 ? b.sum / b.count : null
      })
      .filter((v): v is number => v != null)

    return series.length > 0 ? series : null
  }

  const triples: Array<{
    xRaw: unknown
    yRaw: unknown
    z: number
    xNum: number | null
    yNum: number | null
  }> = []
  for (const row of rows) {
    const xRaw = row[xPath]
    const yRaw = row[yPath]
    const z = getNum(row, vPath)
    if (xRaw == null || yRaw == null || z == null) continue
    triples.push({
      xRaw,
      yRaw,
      z,
      xNum: toFiniteNumber(xRaw),
      yNum: toFiniteNumber(yRaw),
    })
  }

  if (triples.length === 0) return null

  const allNumericXY = triples.every((t) => t.xNum != null && t.yNum != null)
  if (allNumericXY) {
    const numeric = triples.map((t) => ({ x: t.xNum as number, y: t.yNum as number, z: t.z }))
    const xMin = Math.min(...numeric.map((p) => p.x))
    const xMax = Math.max(...numeric.map((p) => p.x))
    const yMin = Math.min(...numeric.map((p) => p.y))
    const yMax = Math.max(...numeric.map((p) => p.y))

    const isAutoResolution = opts?.resolution === 'auto' || opts?.resolution == null

    // Optuna-like auto mode: render an interpolated regular grid from observed points.
    // This avoids checkerboard artifacts when each (x, y) pair is unique.
    if (isAutoResolution) {
      const gridSize = clampInt(Math.sqrt(numeric.length) * 6, 24, 72)
      const xValues = linspace(xMin, xMax, xMax > xMin ? gridSize : 1)
      const yValues = linspace(yMin, yMax, yMax > yMin ? gridSize : 1)

      const points: Array<{ x: number; y: number; v: number }> = []
      for (const y of yValues) {
        for (const x of xValues) {
          let wSum = 0
          let zvSum = 0
          for (const p of numeric) {
            const dx = x - p.x
            const dy = y - p.y
            const d2 = dx * dx + dy * dy
            // IDW kernel; power-1 style to keep smoother contour-like transitions.
            const w = 1 / (Math.sqrt(d2) + 1e-6)
            wSum += w
            zvSum += w * p.z
          }
          if (wSum > 0) points.push({ x, y, v: zvSum / wSum })
        }
      }

      return {
        kind: 'xyv-heatmap',
        xValues,
        yValues,
        points,
      }
    }

    const forcedResolution = typeof opts?.resolution === 'number' ? opts.resolution : 16
    const baseBins = clampInt(forcedResolution, 4, 128)
    const xBins = xMax > xMin ? baseBins : 1
    const yBins = yMax > yMin ? baseBins : 1
    const xStep = xBins > 1 ? (xMax - xMin) / xBins : 1
    const yStep = yBins > 1 ? (yMax - yMin) / yBins : 1

    const sum: number[][] = Array.from({ length: yBins }, () => Array.from({ length: xBins }, () => 0))
    const count: number[][] = Array.from({ length: yBins }, () =>
      Array.from({ length: xBins }, () => 0),
    )

    for (const p of numeric) {
      const xi =
        xBins === 1 ? 0 : Math.max(0, Math.min(xBins - 1, Math.floor((p.x - xMin) / xStep)))
      const yi =
        yBins === 1 ? 0 : Math.max(0, Math.min(yBins - 1, Math.floor((p.y - yMin) / yStep)))
      sum[yi]![xi]! += p.z
      count[yi]![xi]! += 1
    }

    const zMat: number[][] = Array.from({ length: yBins }, (_, yi) =>
      Array.from({ length: xBins }, (_, xi) => {
        const c = count[yi]![xi]!
        return c > 0 ? sum[yi]![xi]! / c : Number.NaN
      }),
    )

    const knownCells: Array<{ xi: number; yi: number; z: number }> = []
    for (let yi = 0; yi < yBins; yi++) {
      for (let xi = 0; xi < xBins; xi++) {
        const zVal = zMat[yi]![xi]!
        if (!Number.isNaN(zVal)) knownCells.push({ xi, yi, z: zVal })
      }
    }

    if (knownCells.length > 0) {
      for (let yi = 0; yi < yBins; yi++) {
        for (let xi = 0; xi < xBins; xi++) {
          if (!Number.isNaN(zMat[yi]![xi]!)) continue
          let wSum = 0
          let zvSum = 0
          for (const c of knownCells) {
            const dx = xi - c.xi
            const dy = yi - c.yi
            const d2 = dx * dx + dy * dy
            const w = 1 / (d2 + 1)
            wSum += w
            zvSum += w * c.z
          }
          if (wSum > 0) zMat[yi]![xi] = zvSum / wSum
        }
      }
    }

    const xValues = Array.from({ length: xBins }, (_, i) =>
      xBins === 1 ? xMin : xMin + (i + 0.5) * xStep,
    )
    const yValues = Array.from({ length: yBins }, (_, i) =>
      yBins === 1 ? yMin : yMin + (i + 0.5) * yStep,
    )
    const points: Array<{ x: number; y: number; v: number }> = []
    for (let yi = 0; yi < yBins; yi++) {
      for (let xi = 0; xi < xBins; xi++) {
        const zVal = zMat[yi]![xi]!
        if (Number.isNaN(zVal)) continue
        points.push({ x: xValues[xi]!, y: yValues[yi]!, v: zVal })
      }
    }

    return {
      kind: 'xyv-heatmap',
      xValues,
      yValues,
      points,
    }
  }

  const xs = sortCategoryValues(triples.map((t) => safeToString(t.xRaw)))
  const ys = sortCategoryValues(triples.map((t) => safeToString(t.yRaw)))

  const xIndex = new Map(xs.map((v, i) => [v, i]))
  const yIndex = new Map(ys.map((v, i) => [v, i]))

  const zMat: number[][] = Array.from({ length: ys.length }, () =>
    Array.from({ length: xs.length }, () => Number.NaN),
  )

  for (const t of triples) {
    const xi = xIndex.get(safeToString(t.xRaw))
    const yi = yIndex.get(safeToString(t.yRaw))
    if (xi == null || yi == null) continue
    zMat[yi]![xi] = t.z
  }

  return zMat
}
