import {
  createCombinedCrudWrapper,
  createMapCrudWrapper,
  type CrudWrapper,
} from '../utils/crudWrapper'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const createDeferredSetWrapper = <T>(base: CrudWrapper<T>) => {
  let continueSet: (() => void) | undefined
  const setBarrier = new Promise<void>((resolve) => {
    continueSet = resolve
  })

  return {
    wrapper: {
      ...base,
      async set(id: string | number, data: T) {
        await setBarrier
        await base.set(id, data)
      },
    },
    continueSet: () => continueSet?.(),
  }
}

export const testCombinedCrudEmitsAfterMemoryWrite = async () => {
  const memory = createMapCrudWrapper<string>(new Map())
  const persistent = createDeferredSetWrapper(createMapCrudWrapper<string>(new Map()))
  const combined = createCombinedCrudWrapper([memory, persistent.wrapper])
  const events: Array<{ id: string | number; data: string | null }> = []
  combined.liveStream((event) => {
    events.push(event)
  })

  const write = combined.set('task-1', 'created')
  await Promise.resolve()
  await Promise.resolve()

  assert((await memory.get('task-1')) === 'created', 'Expected the first layer to be updated')
  assert(events.length === 1, 'Expected a live event before persistent storage completed')

  persistent.continueSet()
  await write
  return events
}

export const testCombinedCrudHydratesMemorySilently = async () => {
  const memory = createMapCrudWrapper<string>(new Map())
  const persistent = createMapCrudWrapper<string>(new Map([['task-1', 'persisted']]))
  const combined = createCombinedCrudWrapper([memory, persistent])
  const events: Array<{ id: string | number; data: string | null }> = []
  combined.liveStream((event) => {
    events.push(event)
  })

  const result = await combined.get('task-1')

  assert(result === 'persisted', 'Expected the value from persistent storage')
  assert((await memory.get('task-1')) === 'persisted', 'Expected the first layer to be hydrated')
  assert(events.length === 0, 'Expected cache hydration to remain silent')
  return result
}

export const testCombinedCrudRollsBackFailedPersistence = async () => {
  const memory = createMapCrudWrapper<string>(new Map())
  const persistent = {
    ...createMapCrudWrapper<string>(new Map()),
    set: () => Promise.reject(new Error('persistence failed')),
  }
  const combined = createCombinedCrudWrapper([memory, persistent])
  const events: Array<{ id: string | number; data: string | null }> = []
  combined.liveStream((event) => {
    events.push(event)
  })

  let rejected = false
  try {
    await combined.set('task-1', 'created')
  } catch {
    rejected = true
  }

  assert(rejected, 'Expected the failed persistent write to reject')
  assert((await memory.get('task-1')) === null, 'Expected the memory write to be rolled back')
  assert(events.at(0)?.data === 'created', 'Expected the accepted value to be published first')
  assert(events.at(1)?.data === null, 'Expected the rollback to be published')
  return events
}

testCombinedCrudEmitsAfterMemoryWrite.description =
  'Publishes explicit writes after the memory layer accepts them, before persistence completes.'
testCombinedCrudHydratesMemorySilently.description =
  'Promotes persisted values into memory without reporting them as newly written values.'
testCombinedCrudRollsBackFailedPersistence.description =
  'Restores the first layer and publishes the correction when persistent storage fails.'
