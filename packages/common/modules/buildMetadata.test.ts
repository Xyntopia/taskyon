import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadBuildMetadata, parseBuildMetadata } from './buildMetadata.ts'

void test('build metadata parses the image document', () => {
  assert.deepEqual(
    parseBuildMetadata({
      commit: 'abc123',
      publishDate: '2026-09-15T10:00:00.000Z',
    }),
    {
      commit: 'abc123',
      publishDate: '2026-09-15T10:00:00.000Z',
    },
  )
})

void test('build metadata rejects malformed documents', () => {
  assert.throws(
    () => parseBuildMetadata({ commit: 'abc123', publishDate: 42 }),
    /Invalid build metadata/,
  )
})

void test('build metadata loads only when explicitly called', async () => {
  let requests = 0
  const fetchMetadata = () => {
    requests += 1
    return Promise.resolve(
      new Response(JSON.stringify({ commit: 'abc123', publishDate: '2026-09-15T10:00:00.000Z' })),
    )
  }

  assert.equal(requests, 0)
  assert.equal((await loadBuildMetadata(fetchMetadata)).commit, 'abc123')
  assert.equal(requests, 1)
})
