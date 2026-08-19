import { createPgLiteCrudWrapper } from '../utils/crudWrapper'
import { getInMemoryDatabase } from '../utils/pglite.api'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testPgLiteCrudBatchInsertStoresRows = async () => {
  const database = await getInMemoryDatabase(`crud-batch-${Date.now()}`)
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
}

testPgLiteCrudBatchInsertStoresRows.description =
  'Stores rows through the PGlite CRUD batch insert path.'
