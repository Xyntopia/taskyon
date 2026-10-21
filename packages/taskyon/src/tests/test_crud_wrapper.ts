import { createPgLiteCrudWrapper, createVectorStore } from '../utils/crudWrapper'
import { createInMemoryDatabase } from '../utils/pglite.api'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testPgLiteCrudBatchInsertStoresRows = async () => {
  const database = await createInMemoryDatabase('crud-batch-diagnostic')
  try {
    const crud = await createPgLiteCrudWrapper<{ value: string }>(database, {
      tableName: `crud_batch_${Date.now()}`,
    })

    await crud.batchInsert([
      { id: 'first', data: { value: 'one' } },
      { id: 'second', data: { value: 'two' } },
    ])

    const rows = await crud.list()
    assert(rows.length === 2, 'Expected batchInsert to store both rows')
    assert(
      rows.some((row) => row.id === 'first' && row.data.value === 'one'),
      'Missing first row',
    )
    assert(
      rows.some((row) => row.id === 'second' && row.data.value === 'two'),
      'Missing second row',
    )
    return rows
  } finally {
    await database.close()
  }
}

testPgLiteCrudBatchInsertStoresRows.description =
  'Stores rows through the PGlite CRUD batch insert path.'

export const testVectorSearchFilteredQueryUsesValidSql = async () => {
  const database = await createInMemoryDatabase('crud-vector-filter-diagnostic')
  try {
    const store = await createVectorStore<{
      content: { type: string }
      label: string
    }>(database, `crud_vector_filter_${Date.now()}`)
    const vector = Array.from({ length: 256 }, () => 0)
    await store.upsertVector('message-1', 'weather forecast', vector, {
      content: { type: 'message' },
      label: 'weather forecast',
    })
    await store.upsertVector('result-1', 'weather forecast', vector, {
      content: { type: 'toolresult' },
      label: 'weather forecast',
    })

    const filtered = await store.search('weather forecast', 5, undefined, {
      content: { type: 'message' },
    })
    assert(
      filtered.some(({ id }) => id === 'message-1'),
      'Expected filtered search to find message',
    )
    assert(!filtered.some(({ id }) => id === 'result-1'), 'Expected filter to exclude result row')

    const allowed = await store.search('weather forecast', 5, ['message-1'])
    assert(
      allowed.some(({ id }) => id === 'message-1'),
      'Expected allowed-ID search to find message',
    )
    assert(
      !allowed.some(({ id }) => id === 'result-1'),
      'Expected allowed-ID search to exclude result',
    )
    return { filtered, allowed }
  } finally {
    await database.close()
  }
}

testVectorSearchFilteredQueryUsesValidSql.description =
  'Searches with JSON filters and allowed IDs without producing invalid SQL.'
