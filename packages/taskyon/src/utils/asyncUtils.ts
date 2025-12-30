// Async sleep function
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class Lock {
  //TODO: the function which is returned to resolve the promise
  //      should be a callable object and automatically resolve
  //      when it is destroyed for example when running out of scope
  //      in a function...
  private _promise: Promise<void> | null = null

  /**
   * Acquires the lock if available. Returns a `release` function to be called
   * when done. Waits if the lock is already held.
   *
   * !!!!IMPORTANT!!!!  it is very important that when a lock is acquired all functions
   * until the lock is released are either synchronous or awaited. Otherwise
   * it is possible that the unlock happens before some of the code is finished...
   *
   * @returns {Promise<() => void>} A function to release the lock.
   * @example
   * const release = await lock.lock();
   * try { ...critical section... } finally { release(); }
   *
   *
   *
   */
  async lock(): Promise<() => void> {
    let outerResolve: () => void
    if (!this._promise) {
      this._promise = new Promise<void>((resolve) => {
        outerResolve = () => {
          //console.log('unlock!')
          resolve()
        }
      })

      return () => {
        if (outerResolve) {
          outerResolve()
          this._promise = null
        }
      }
    } else {
      //console.log('waiting for unlock to relock')
      await this._promise // Wait for the lock to be released
      return this.lock() // Re-attempt to acquire the lock
    }
  }

  /**
   * Waits until the lock is released without acquiring it.
   *
   * @returns {Promise<void>} Resolves when the lock is free.
   * @example
   * await lock.waitForUnlock();
   */
  async waitForUnlock(): Promise<void> {
    if (this._promise) {
      await this._promise
    }
  }
}

// Wraps a function so it can only run one instance at a time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function exclusive<F extends (...args: any) => any>(fn: F): F {
  const lock = new Lock()

  const wrapped = (async (...args: Parameters<F>): Promise<ReturnType<F>> => {
    const release = await lock.lock()
    try {
      return await fn(...args)
    } finally {
      release()
    }
  }) as F

  return wrapped
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function latestOnly<F extends (...args: any[]) => Promise<any>>(fn: F): F {
  let callId = 0

  return (async (...args: Parameters<F>): Promise<ReturnType<F>> => {
    const id = ++callId
    const result = await fn(...args)
    // If a newer call has started since we began, drop this result
    if (id !== callId) {
      // @ts-expect-error - we are explicitly discarding stale results
      return
    }
    return result as ReturnType<F>
  }) as F
}

export function lockMap(name: string = 'item') {
  const locks = new Map<string | number, Lock>()

  // Lock am item and returns a function closure which can be used to unlock it again...
  async function lockItem(id: string | number) {
    let lock = locks.get(id)
    if (!lock) {
      lock = new Lock()
      locks.set(id, lock)
    }
    //console.log(`getting lock for ${name}:`, id)
    const unlock = await lock.lock()
    //console.log(`acquired lock for ${name}`, id)
    return () => {
      //console.log(`unlock ${name}!`, id)
      unlock()
      locks.delete(id) // Delete the lock from the map after unlocking
    }
  }

  // this function simply waits for an item to be unlocked, but doesn't
  // acquire a lock itself...
  async function waitForItemUnlock(id: string | number) {
    const lock = locks.get(id)
    if (lock) {
      // TODO: why is this called so often??
      //console.log('wait for unlock!');
      await lock.waitForUnlock()
    }
  }

  function clearLocks() {
    locks.clear()
    console.log(`All ${name} locks have been cleared`)
  }

  return { lockItem, waitForItemUnlock, clearLocks }
}

export function createAsyncQueue<T>() {
  let queue: T[] = []
  let resolveWaitingPop: ((value: T) => void) | undefined

  function push(item: T) {
    queue.push(item)
    if (resolveWaitingPop) {
      const shiftedItem = queue.shift()
      if (shiftedItem !== undefined) {
        resolveWaitingPop(shiftedItem)
      }
      resolveWaitingPop = undefined
    }
  }

  function count() {
    return queue.length
  }

  function pop(signal?: AbortSignal): Promise<T> {
    // if there’s already an item, just return it immediately
    const shiftedItem = queue.shift()
    if (shiftedItem !== undefined) {
      return Promise.resolve(shiftedItem)
    }

    // otherwise we wait, but allow aborting
    return new Promise<T>((resolve, reject) => {
      // if already aborted
      if (signal?.aborted) {
        return reject(new DOMException('Pop aborted', 'AbortError'))
      }

      // cleanup helper
      const cleanup = () => {
        // only clear if it’s still our resolver
        if (resolveWaitingPop === onValue) {
          resolveWaitingPop = undefined
        }
        signal?.removeEventListener('abort', onAbort)
      }

      const onValue = (value: T) => {
        cleanup()
        resolve(value)
      }

      const onAbort = () => {
        cleanup()
        console.log('aborting async queue pop')
        reject(new DOMException('Pop aborted', 'AbortError'))
      }

      // install our resolver
      resolveWaitingPop = onValue
      // listen for abort
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  function clear() {
    const oldQueue = queue
    queue = []
    return oldQueue
  }

  return { push, pop, count, clear }
}
export type AsyncQueue<T> = ReturnType<typeof createAsyncQueue<T>>

// ---------- keyedLock.ts ----------
type Key = string | number

export class KeyedMutex {
  private chains = new Map<Key, Promise<void>>()

  // Run fn exclusively for this key. Different keys run concurrently.
  async runExclusive<T>(key: Key, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolve) => (release = resolve))
    // Chain: current becomes prev.then(() => next)
    this.chains.set(
      key,
      prev.then(() => next),
    )
    // Wait our turn
    await prev
    try {
      return await fn()
    } finally {
      release()
      // Optional: best-effort cleanup to prevent unbounded key growth.
      // We don't know if someone already chained after us; leave entry as is.
      // In practice this is fine; if needed, add periodic cleanup.
    }
  }
}

export type Locker = <R>(id: string | number, fn: () => Promise<R> | R) => Promise<R>
