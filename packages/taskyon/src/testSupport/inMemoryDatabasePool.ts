import { createInMemoryDatabase } from '../utils/pglite.api'

export const createInMemoryDatabasePool = () => {
  const databases = new Map<string, ReturnType<typeof createInMemoryDatabase>>()
  const databaseFactory = async (name: string) => {
    const existing = databases.get(name)
    if (existing) return await existing
    const created = createInMemoryDatabase(name)
    databases.set(name, created)
    try {
      return await created
    } catch (error) {
      databases.delete(name)
      throw error
    }
  }
  const closeDatabases = async () => {
    const pendingDatabases = [...databases.values()]
    databases.clear()
    await Promise.all(pendingDatabases.map(async (database) => await (await database).close()))
  }
  return { databaseFactory, closeDatabases }
}
