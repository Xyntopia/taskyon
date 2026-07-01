import { Lock, sleep } from '../utils/asyncUtils'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testLockWithLockSerializesConcurrentWork = async () => {
  const lock = new Lock()
  let active = 0
  let maxActive = 0
  const events: string[] = []

  const run = (name: string) =>
    lock.withLock(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      events.push(`start:${name}`)
      await sleep(1)
      events.push(`end:${name}`)
      active -= 1
      return name
    })

  const results = await Promise.all([run('a'), run('b'), run('c')])

  assert(maxActive === 1, `Expected serialized work, maxActive=${maxActive}`)
  assert(results.join(',') === 'a,b,c', `Unexpected results: ${results.join(',')}`)
  for (const name of ['a', 'b', 'c']) {
    const startIndex = events.indexOf(`start:${name}`)
    const endIndex = events.indexOf(`end:${name}`)
    assert(startIndex >= 0 && endIndex > startIndex, `Missing ordered events for ${name}`)
  }
  return { events, maxActive, results }
}

export const testLockWithLockReleasesAfterThrow = async () => {
  const lock = new Lock()
  let threw = false
  try {
    await lock.withLock(() => {
      throw new Error('expected')
    })
  } catch {
    threw = true
  }

  const result = await lock.withLock(() => 'reacquired')

  assert(threw, 'Expected first withLock call to throw')
  assert(result === 'reacquired', `Expected lock to be released, got ${result}`)
  return { result }
}

testLockWithLockSerializesConcurrentWork.description =
  'Runs concurrent critical sections one at a time through Lock.withLock.'
testLockWithLockReleasesAfterThrow.description =
  'Releases the lock when the critical section throws.'
