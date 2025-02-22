// frpBus.ts
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
export function map<A, B>(source: Stream<A>, fn: (value: A) => B): Stream<B> {
  const { stream, emit } = createStream<B>()
  source.subscribe((value) => emit(fn(value)))
  return stream
}

// Operator: filter values based on a predicate
export function filter<T>(source: Stream<T>, predicate: (value: T) => boolean): Stream<T> {
  const { stream, emit } = createStream<T>()
  source.subscribe((value) => {
    if (predicate(value)) {
      emit(value)
    }
  })
  return stream
}
