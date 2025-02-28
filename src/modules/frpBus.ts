// frpBus.ts

import type { Asyncify } from './taskyon/types'

/**
 * Functional Reactive Programming (FRP) Bus
 * A simple implementation of an FRP bus using streams and operators.
 * This is a basic implementation and can be extended with more operators as needed.
 */
export type Observer<T> = (value: T) => void
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
      ;[...observers].forEach((observer) => observer(value))
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

// Operator: prepend an initial value to the source stream
export function startWith<T>(source: Stream<T> | Asyncify<Stream<T>>, initial: T): Stream<T> {
  return {
    subscribe: (observer: Observer<T>): Unsubscribe => {
      // Immediately emit the initial value to the new subscriber
      observer(initial)
      // Then subscribe to the source stream
      const unsubscribe = source.subscribe(observer)
      return () => {
        void Promise.resolve(unsubscribe).then((resolvedUnsubscribe) => resolvedUnsubscribe())
      }
    },
  }
}
