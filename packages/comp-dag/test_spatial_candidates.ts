import { createNode } from './dagCore.ts'
import { iterateSpatialCandidates } from './spatialCandidates.ts'
import type { SpatialCandidateDomain } from './optimization.ts'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const testSpatialCandidatesLargePolygon = async () => {
  const ring = Array.from({ length: 140000 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 140000
    return [Math.cos(angle), Math.sin(angle)]
  })
  ring.push(ring[0]!)
  const feature = {
    type: 'Feature',
    id: 'large',
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
  for (const mode of ['perFeature', 'grid'] as const) {
    const candidates = iterateSpatialCandidates({
      domain: {
        kind: 'spatial',
        mode,
        featureAlias: 'parcel',
        coordinatePaths: { lat: 'lat', lon: 'lon' },
        grid: { originLat: 0, originLon: 0, stepLatDeg: 1, stepLonDeg: 1, levels: 0 },
      },
      features: [{ sourceIndex: 0, value: feature }],
      params: {},
      readPath: () => undefined,
      order: 'sequential',
    })
    let count = 0
    for await (const candidate of candidates) {
      assert(candidate.featureIds[0] === 'large', 'Expected the large polygon candidate identity')
      assert(
        Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon),
        'Expected finite coordinates',
      )
      count += 1
      break
    }
    assert(count === 1, 'Expected a candidate from a polygon exceeding argument limits')
  }
  return { success: true }
}

export const testSpatialStudyStopsDuringRejectedGridScan = async () => {
  const square = (offset: number) => [
    [offset, offset],
    [offset + 0.00001, offset],
    [offset + 0.00001, offset + 0.00001],
    [offset, offset + 0.00001],
    [offset, offset],
  ]
  const region = {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: [[square(0.0001)], [square(1.0001)]] },
  }
  const node = createNode({
    name: 'rejected_spatial_grid_budget',
    version: 1,
    localParams: {
      type: 'object',
      properties: { region: {}, lat: { type: 'number' }, lon: { type: 'number' } },
      required: ['region'],
    },
    outputSchema: {},
    run: () => ({ success: true }),
  })
  for (const gridOrder of ['sequential', 'coarseToFine'] as const) {
    const domain: SpatialCandidateDomain = {
      kind: 'spatial',
      mode: 'grid',
      regionPath: 'region',
      coordinatePaths: { lat: 'lat', lon: 'lon' },
      grid: { originLat: 0, originLon: 0, stepLatDeg: 1, stepLonDeg: 1, levels: 8 },
    }
    let eventLoopRan = false
    const timer = setTimeout(() => {
      eventLoopRan = true
    }, 0)
    const start = Date.now()
    try {
      const result = await node
        .call({ region })
        .study({ candidateDomain: domain, gridOrder, budget: { timeMs: 25 } })
      assert(
        result.stoppedReason === 'timeMs',
        'Expected rejected-point traversal to stop at its time budget',
      )
      assert(result.rows.length === 0, 'Expected no lattice points within the tiny polygons')
      assert(eventLoopRan, 'Expected rejected-point traversal to yield to the event loop')
      const elapsedMs = Date.now() - start
      assert(
        elapsedMs < 2000,
        `Expected the time budget to stop rejected-point scanning before exhaustion (${elapsedMs}ms)`,
      )
    } finally {
      clearTimeout(timer)
    }
  }
  return { success: true }
}

export const testSpatialCandidatesStopDuringFeatureRejections = async () => {
  const feature = {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [0.0001, 1.0001].map((offset) => [
        [
          [offset, offset],
          [offset + 0.00001, offset],
          [offset + 0.00001, offset + 0.00001],
          [offset, offset + 0.00001],
          [offset, offset],
        ],
      ]),
    },
  }
  for (const order of ['sequential', 'coarseToFine'] as const) {
    let checks = 0
    let timerRan = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const candidates = iterateSpatialCandidates({
      domain: {
        kind: 'spatial',
        mode: 'grid',
        coordinatePaths: { lat: 'lat', lon: 'lon' },
        grid: { originLat: 0, originLon: 0, stepLatDeg: 1, stepLonDeg: 1, levels: 8 },
      },
      features: [{ sourceIndex: 0, value: feature }],
      params: {},
      readPath: () => undefined,
      order,
      shouldStop: () => {
        checks += 1
        if (checks === 1)
          timer = setTimeout(() => {
            timerRan = true
          }, 0)
        return checks >= 300
      },
    })
    try {
      for await (const candidate of candidates) {
        throw new Error(`Expected only rejected points, received ${candidate.gridKey}`)
      }
      assert(checks === 300, 'Expected feature rejection traversal to honor stopping checks')
      assert(timerRan, 'Expected a periodic yield after scanning rejected feature points')
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  return { success: true }
}
