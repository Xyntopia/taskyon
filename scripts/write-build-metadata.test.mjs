import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createBuildMetadataDocument } from './write-build-metadata.mjs'

void it('writes deterministic image metadata JSON', () => {
  assert.equal(
    createBuildMetadataDocument(' abc123 ', ' 2026-09-15T10:00:00.000Z '),
    '{"commit":"abc123","publishDate":"2026-09-15T10:00:00.000Z"}\n',
  )
})
