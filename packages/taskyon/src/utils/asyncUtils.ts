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
