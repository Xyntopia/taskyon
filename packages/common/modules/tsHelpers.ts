//type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequireSome<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>

export type OptionalSome<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export type RequireDefined<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: Exclude<T[P], undefined>
}

export type RemoveUndefined<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: Exclude<T[P], undefined>
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function assertType<T>(value: T): void {
  // This function does nothing at runtime, but it enforces type checking at compile time.
}

// Recursively expand every object level
export type ExpandRecursively<T> = T extends object
  ? { [K in keyof T]: ExpandRecursively<T[K]> }
  : T

export type Expand<T> = T extends infer U ? { [K in keyof U]: U[K] } : never

// takes an object and turns all of its functions into async...
export type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K]
}
//export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] }
export type WithRequired<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: Exclude<T[P], undefined>
}

/**
 * Type describing a generic function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFunction<ReturnType> = (...args: any[]) => ReturnType

/**
 * Type representing a thunk: a function that takes no arguments and returns T.
 */
export type Thunk<T> = () => T

// used to "hide" properties of a type to make it more readable..
export type Identity<T> = T

export type ByType<K extends T['type'], T extends { type: string }> = Extract<T, { type: K }>
