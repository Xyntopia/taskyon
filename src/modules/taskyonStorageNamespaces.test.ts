import assert from 'node:assert/strict'
import test from 'node:test'
import { secureFetchCacheNamespace } from '@taskyon/taskyon/api'
import { isBrowserRecordNamespace } from './taskyonStorageNamespaces'

void test('browser storage permits the canonical secure fetch cache namespace', () => {
  assert.equal(isBrowserRecordNamespace(secureFetchCacheNamespace), true)
})
