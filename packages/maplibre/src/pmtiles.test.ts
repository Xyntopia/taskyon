import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPmtilesUrlCandidates } from './urlCandidates.ts'

void test('builds deterministic PMTiles candidates without third-party fallbacks', () => {
  assert.deepEqual(buildPmtilesUrlCandidates('https://maps.example/world.pmtiles'), [
    'https://maps.example/world.pmtiles',
  ])
  assert.deepEqual(
    buildPmtilesUrlCandidates('https://maps.example/archive/', {
      suffixes: ['world.pmtiles', '/world.pmtiles', 'basemap.pmtiles'],
    }),
    [
      'https://maps.example/archive',
      'https://maps.example/archive.pmtiles',
      'https://maps.example/archive/world.pmtiles',
      'https://maps.example/archive/basemap.pmtiles',
    ],
  )
})
