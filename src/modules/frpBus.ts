// frpBus.ts

import type { Asyncify } from './taskyon/types'

/**
 * Functional Reactive Programming (FRP) Bus
 * A simple implementation of an FRP bus using streams and operators.
 * This is a basic implementation and can be extended with more operators as needed.
 */
export type Observer<T> = (value: T) => void | Promise<void>
export type Unsubscribe = () => void

export interface Stream<T> {
  subscribe(observer: Observer<T>): Unsubscribe
}

// Creates a simple stream with an "emit" function
export function createStream<T>(): { stream: Stream<T>; emit: (value: T) => void } {
  const observers: Observer<T>[] = []
  return {
    stream: {
      subscribe(observer: Observer<T>): Unsubscribe {
        observers.push(observer)
        return () => {
          const index = observers.indexOf(observer)
          if (index > -1) observers.splice(index, 1)
        }
      },
    },
    emit(value: T) {
      // Create a copy to avoid issues if observers unsubscribe during iteration
      ;[...observers].forEach((observer) => void observer(value))
    },
  }
}

// Operator: transform each value from the source stream
export function map<A, B>(source: Stream<A> | Asyncify<Stream<A>>, fn: (value: A) => B): Stream<B> {
  const { stream, emit } = createStream<B>()
  void source.subscribe((value) => emit(fn(value)))
  return stream
}

// Operator: filter values based on a predicate
export function filter<A>(
  source: Stream<A> | Asyncify<Stream<A>>,
  predicate: (value: A) => boolean,
): Stream<A> {
  const { stream, emit } = createStream<A>()
  void source.subscribe((value) => {
    if (predicate(value)) {
      emit(value)
    }
  })
  return stream
}

/**
 * Merges streams of different types into a single stream emitting a union type.
 * Usage: merge(streamA, streamB) → Stream<A | B>
 */
export function merge<T extends unknown[]>(
  ...sources: { [K in keyof T]: Stream<T[K]> | Asyncify<Stream<T[K]>> }
): Stream<T[number]> {
  const { stream, emit } = createStream<T[number]>()

  sources.forEach((source) => {
    void source.subscribe((value) => emit(value)) // Full type safety
  })

  return stream
}

export function requireSubscribers<T>(
  source: Stream<T> | Asyncify<Stream<T>>,
  min: number = 1,
): Stream<T> {
  const { stream, emit } = createStream<T>()
  let subscriberCount = 0

  // Subscribe to the source stream
  void source.subscribe((value) => {
    if (subscriberCount < min) {
      throw new Error(`Not enough subscribers: got ${subscriberCount}, need at least ${min}`)
    }
    emit(value)
  })

  return {
    subscribe: (observer: Observer<T>): Unsubscribe => {
      subscriberCount++
      const unsubscribe = stream.subscribe(observer)
      return () => {
        subscriberCount--
        void Promise.resolve(unsubscribe).then((resolvedUnsubscribe) => resolvedUnsubscribe())
      }
    },
  }
}

export function streamProcedureCall<T extends unknown[], R>(timeoutMs?: number) {
  const { stream, emit } = createStream<{
    args: T
    respond: (result: R) => void
  }>()

  const emitFunc: (...args: T) => Promise<R> = (...args) => {
    return new Promise<R>((resolve, reject) => {
      let responded = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      // Set up timeout for default or error
      if (timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          if (!responded) {
            responded = true
            // TODO: add default response here...
            reject(new Error('No response within timeout'))
          }
        }, timeoutMs)
      }
      console.log('Emitting args:', args)
      emit({
        args,
        respond: (result: R) => {
          if (!responded) {
            responded = true
            if (timeout) clearTimeout(timeout)
            resolve(result)
          }
        },
      })
    })
  }

  return { emitFunc, stream: requireSubscribers(stream, 1) }
}
