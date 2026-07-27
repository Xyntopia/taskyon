// frpBus.ts
import { z } from 'zod'
import { hydrateRemoteError, serializeRemoteError } from './remoteError.ts'
import { awaitRequestResponse } from './requestLifecycle.ts'

/**
 * Functional Reactive Programming (FRP) Bus
 * A simple implementation of an FRP bus using streams and operators.
 * This is a basic implementation and can be extended with more operators as needed.
 */
export type Observer<T> = (value: T) => void | Promise<void>
export type Unsubscribe = () => void

export interface Stream<T> {
  (observer: Observer<T>): Unsubscribe
  unsubscribeAll(this: void): void
  filter(this: void, predicate: (value: T) => boolean): Stream<T>
  narrow<U extends T>(this: void, predicate: (value: T) => value is U): Stream<U>
  map<V>(this: void, fn: (value: T) => V): Stream<V>
  wait(this: void, opts: { timeoutMs?: number; signal?: AbortSignal }): Promise<T>
}

export type frpBus<T> = {
  stream: Stream<T>
  emit: <U extends T>(value: U) => void
}

// Creates a simple stream with an "emit" function
export function createStream<T>(): frpBus<T> {
  const observers: Observer<T>[] = []

  const stream = (observer: Observer<T>): Unsubscribe => {
    observers.push(observer)
    return () => {
      const idx = observers.indexOf(observer)
      if (idx >= 0) observers.splice(idx, 1)
    }
  }

  stream.unsubscribeAll = () => {
    observers.length = 0
  }

  // TODO: if we use a filter like that... how can we make sure, that we unsubscribe from the original
  //       stream, if we unsubscrbe from the new stream (unsub)? we might want to have multiple
  //       streams subscribing on the filtered, so we can't jsut do it from the last "unsub" in the chain...
  //       maybe add an "unsubchain" or something like that?
  stream.narrow = <U extends T>(pred: (m: T) => m is U) => {
    const newStream = createStream<U>()
    /*const unsub = */ stream((v) => {
      if (pred(v)) newStream.emit(v)
    })
    return newStream.stream
  }
  stream.map = <V>(fn: (value: T) => V): Stream<V> => {
    const newStream = createStream<V>()
    stream((v) => newStream.emit(fn(v)))
    return newStream.stream
  }
  stream.filter = stream.narrow<T>
  stream.wait = ((opts) =>
    new Promise<T>((resolve, reject) => {
      if (opts?.signal?.aborted) {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
        return
      }

      let done = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      let unsub: Unsubscribe = () => {}

      const finish = (err?: Error, value?: T) => {
        if (done) return
        done = true
        unsub()
        clearTimeout(timeout)
        opts?.signal?.removeEventListener('abort', onAbort)
        if (err) reject(err)
        else resolve(value!)
      }

      const onAbort = () => {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        finish(err)
      }

      opts?.signal?.addEventListener('abort', onAbort)
      if (opts?.timeoutMs)
        timeout = setTimeout(
          () => finish(new Error(`Timeout after ${opts.timeoutMs}ms`)),
          opts.timeoutMs,
        )

      const observer = (value: T) => finish(undefined, value)
      unsub = stream(observer)
    })) as Stream<T>['wait']

  return {
    stream,
    emit: (v: T) => {
      ;[...observers].forEach((o) => void o(v))
    },
  }
}

// extract stream type frm existing stream
export type extractStreamType<Type> = Type extends Stream<infer X> ? X : never

export type Port<Tx, Rx = Tx> = {
  send: frpBus<Tx>['emit']
  receive: frpBus<Rx>['stream']
  // stricter connect signature: intersection forces compile-time failure when constraints don't hold
  connect: <Tx, Rx extends oTx, oTx, oRx extends Tx>(
    this: Port<Tx, Rx>,
    other: Port<oTx, oRx>,
  ) => Unsubscribe
}

export type DuplexChannel<Tx, Rx> = { x: Port<Tx, Rx>; y: Port<Rx, Tx> }

const connectChannels = <Tx, Rx, oTx, oRx>(x: Port<Tx, Rx>, y: Port<oTx, oRx>): Unsubscribe => {
  const unsubX = x.receive((msg) => y.send(msg as unknown as oTx))
  const unsubY = y.receive((msg) => x.send(msg as unknown as Tx))

  // Return a function that disconnects both subscriptions
  return () => {
    unsubX()
    unsubY()
  }
}

const makePort = <Tx, Rx = Tx>(
  send: frpBus<Tx>['emit'],
  receive: frpBus<Rx>['stream'],
): Port<Tx, Rx> => {
  const self: Port<Tx, Rx> = {
    send,
    receive,
    connect: (other) => connectChannels(self, other),
  }
  return self
}

export const createChannelsFromStreams = <Str1, Str2 = Str1>(
  outS: frpBus<Str1>,
  inS: frpBus<Str2>,
): DuplexChannel<Str1, Str2> => ({
  x: makePort(outS.emit, inS.stream),
  y: makePort(inS.emit, outS.stream),
})

export const createDuplexChannel = <Str1, Str2 = Str1>(): DuplexChannel<Str1, Str2> =>
  createChannelsFromStreams(createStream<Str1>(), createStream<Str2>())

type RequestName<T> = T extends { type: `${infer TName}Request`; requestId: string } ? TName : never

type RequestPayload<T> = Omit<T, 'type' | 'requestId'>

type ResponseResult<T> = T extends { result: infer TResult } ? TResult : void

type ResponseForName<T, TName extends string> = Extract<
  T,
  { type: `${TName}Response`; requestId: string }
>

export type PortClientFromMessages<Tx, Rx> = {
  [TName in RequestName<Tx>]: (
    args: RequestPayload<Extract<Tx, { type: `${TName}Request`; requestId: string }>> &
      PortRpcClientOptions,
  ) => Promise<ResponseResult<ResponseForName<Rx, TName>>>
}

/* TODO: adapt this by createing a port which
export function portMap<A, B>(
  source: Port<A>,
  fnIn: (value: A) => B,
  fnOut: (value: B) => A,
): { port: Port<B>; destroy: () => void } {
  const { a: inner, b: outer } = createDuplexChannel<B>()

  // Upstream ➜ child (apply the filter)
  const unsubUp = source.receive((m) => {
    inner.send(fnIn(m)) // safe: guard proved it’s TChild
  })

  // Child ➜ upstream (no filtering needed)
  const unsubDown = inner.receive((m) => source.send(fnOut(m)))

  const destroy = () => {
    unsubUp()
    unsubDown()
  }

  return { port: outer, destroy }
}*/

export function mapPort<pTx, pRx, cTx extends pTx, cRx extends pRx>(
  port: Port<pTx, pRx>,
  transformTx: (msg: pTx) => cTx,
  transformRx: (msg: pRx) => cRx,
): { port: Port<cTx, cRx>; destroy: () => void } {
  const { x: filtered, y: internal } = createDuplexChannel<cTx, cRx>()

  // Upstream ➜ child (apply the filter)
  const unsubUp = port.receive((m) => {
    internal.send(transformRx(m)) // safe: guard proved it’s TChild
  })

  // Child ➜ upstream (no filtering needed)
  const unsubDown = internal.receive((m) => {
    port.send(transformTx(m)) // safe: guard proved it’s TChild
  })

  const destroy = () => {
    unsubUp()
    unsubDown()
  }

  return { port: filtered, destroy }
}

export function createPortFilter<pTx, pRx, cTx extends pTx, cRx extends pRx>(
  port: Port<pTx, pRx>,
  filterTx: (msg: pTx) => msg is cTx,
  filterRx: (msg: pRx) => msg is cRx,
): { port: Port<cTx, cRx>; destroy: () => void } {
  const { x: filtered, y: internal } = createDuplexChannel<cTx, cRx>()

  // Upstream ➜ child (apply the filter)
  const unsubUp = port.receive((m) => {
    if (filterRx(m)) internal.send(m) // safe: guard proved it’s TChild
  })

  // Child ➜ upstream (no filtering needed)
  const unsubDown = internal.receive((m) => {
    if (filterTx(m)) port.send(m) // safe: guard proved it’s TChild
  })

  const destroy = () => {
    unsubUp()
    unsubDown()
  }

  return { port: filtered, destroy }
}

// lets through messages which are in a  list of types...
export function createTypeFilteredPort<
  pTx, // Parent Transmit type
  pRx extends { type: string }, // Parent Receive type (the superset union)
  K extends pRx['type'], // An array of keys from the union's 'type' property
>(
  parent: Port<pTx, pRx>,
  allowedTypes: readonly K[],
): { port: Port<pTx, Extract<pRx, { type: K }>>; destroy: () => void } {
  // Use a Set for efficient O(1) lookups inside the guard.
  const typeSet = new Set(allowedTypes)

  // Define the new, narrower child message type using TypeScript's Extract utility.
  // This extracts all members from the `pRx` union whose `type` property matches one
  // of the strings in the `allowedTypes` array (`T[number]`).
  type cRx = Extract<pRx, { type: K }>
  // Reuse the generic filtered-port helper with a custom type guard.
  return createPortFilter(
    parent,
    (msg): msg is pTx => true,
    (msg): msg is cRx => typeSet.has(msg.type as K),
  )
}

/**
 * Merges streams of different types into a single stream emitting a union type.
 * Usage: merge(streamA, streamB) → Stream<A | B>
 */
export function merge<T extends unknown[]>(
  ...sources: { [K in keyof T]: Stream<T[K]> }
): Stream<T[number]> {
  const { stream, emit } = createStream<T[number]>()

  sources.forEach((source) => {
    void source((value) => emit(value)) // Full type safety
  })

  return stream
}

export function requireSubscribers<T>(source: Stream<T>, min: number = 1): Stream<T> {
  const { stream, emit } = createStream<T>()
  let subscriberCount = 0

  // Subscribe to the source stream
  void source((value) => {
    if (subscriberCount < min) {
      throw new Error(`Not enough subscribers: got ${subscriberCount}, need at least ${min}`)
    }
    emit(value)
  })

  const subscribe = (observer: Observer<T>) => {
    subscriberCount++
    const unsubscribe = stream(observer)
    return () => {
      subscriberCount--
      void Promise.resolve(unsubscribe).then((resolvedUnsubscribe) => resolvedUnsubscribe())
    }
  }
  subscribe.unsubscribeAll = () => {
    stream.unsubscribeAll()
    subscriberCount = 0
  }
  subscribe.narrow = stream.narrow
  subscribe.filter = stream.narrow<T>
  subscribe.wait = stream.wait
  subscribe.map = stream.map

  return subscribe
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

export type RpcMessagePort<TRequest, TReceive = unknown> = {
  send: (message: TRequest) => void
  receive: (observer: Observer<TReceive>) => Unsubscribe
}

export type RpcScopeStore<TScope> = {
  set: (requestId: string, scope: TScope) => void
  get: (requestId: string) => TScope | undefined
  delete: (requestId: string) => void
}

export function createRpcScopeStore<TScope>(): RpcScopeStore<TScope> {
  const scopes = new Map<string, TScope>()
  return {
    set: (requestId, scope) => scopes.set(requestId, scope),
    get: (requestId) => scopes.get(requestId),
    delete: (requestId) => {
      scopes.delete(requestId)
    },
  }
}

export type RpcResponseResult<TResult> =
  | {
      ok: true
      value: TResult
    }
  | {
      ok: false
      error: Error
    }

export type PortRpcClientOptions = {
  timeoutMs?: number
  signal?: AbortSignal
}

export type PortClientBeforeRequest = (event: {
  command: string
  args: PortRpcClientOptions
}) => void | Promise<void>

export type PortClientOptions = {
  beforeRequest?: PortClientBeforeRequest
  skipBeforeRequestFor?: readonly string[]
}

export type UnaryPortRpcDefinition<
  TRequest extends { requestId: string },
  TResponse extends { requestId: string },
  TArgs,
  TResult,
  TRequestSchema = z.ZodType<TRequest>,
  TResponseSchema = z.ZodType<TResponse>,
> = {
  name: string
  request: TRequestSchema
  response: TResponseSchema
  createRequest: (args: TArgs, requestId: string) => TRequest
  createResponse: (request: { requestId: string }, result: TResult) => TResponse
  createErrorResponse: (request: { requestId: string }, error: unknown) => TResponse
  isResponseForRequest: (response: { requestId: string }, requestId: string) => boolean
  readResponse: (response: TResponse) => RpcResponseResult<TResult>
  createCancelRequest?: (request: TRequest, reason: string) => TRequest
  defaultTimeoutMs?: number | undefined
}

type FrpCommandConfig<
  TRequest extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
  TResponse extends z.ZodType | undefined = z.ZodType | undefined,
> = {
  request: TRequest
  response?: TResponse
  defaultTimeoutMs?: number
}

type FrpMessageConfig = z.ZodObject<z.ZodRawShape>
type FrpMessageGroupConfig = Record<string, FrpMessageConfig>
type EmptyObject = Record<never, never>

let portRpcRequestCounter = 0

const createPortRpcRequestId = (name: string) => `${name}-${Date.now()}-${portRpcRequestCounter++}`

type CommandRequestFromConfig<TName extends string, TConfig extends FrpCommandConfig> = z.output<
  TConfig['request']
> & {
  type: `${TName}Request`
  requestId: string
}

type CommandResultFromConfig<TConfig extends FrpCommandConfig> = TConfig extends {
  response: z.ZodType
}
  ? z.output<TConfig['response']>
  : void

const rpcErrorSchema = z.object({
  message: z.string(),
  name: z.string().optional(),
  stack: z.string().optional(),
})

type CommandResponseShapeFromConfig<TName extends string, TConfig extends FrpCommandConfig> = {
  type: z.ZodLiteral<`${TName}Response`>
  requestId: z.ZodString
  error: z.ZodOptional<typeof rpcErrorSchema>
} & (TConfig extends { response: z.ZodType }
  ? { result: z.ZodOptional<TConfig['response']> }
  : EmptyObject)

type CommandResponseSchemaFromConfig<
  TName extends string,
  TConfig extends FrpCommandConfig,
> = z.ZodObject<CommandResponseShapeFromConfig<TName, TConfig>>

type CommandResponseFromConfig<TName extends string, TConfig extends FrpCommandConfig> = z.output<
  CommandResponseSchemaFromConfig<TName, TConfig>
> & {
  type: `${TName}Response`
  requestId: string
}

type CommandDefinitionFromConfig<
  TName extends string,
  TConfig extends FrpCommandConfig,
> = UnaryPortRpcDefinition<
  CommandRequestFromConfig<TName, TConfig>,
  CommandResponseFromConfig<TName, TConfig>,
  z.input<TConfig['request']>,
  CommandResultFromConfig<TConfig>,
  z.ZodObject<
    Omit<TConfig['request']['shape'], 'type' | 'requestId'> & {
      type: z.ZodLiteral<`${TName}Request`>
      requestId: z.ZodString
    }
  >,
  CommandResponseSchemaFromConfig<TName, TConfig>
>

type FrpCommandDefinitions<TCommands extends Record<string, FrpCommandConfig>> = {
  [K in keyof TCommands]: K extends string ? CommandDefinitionFromConfig<K, TCommands[K]> : never
}

type FrpMessageDefinitionFromConfig<
  TName extends string,
  TConfig extends FrpMessageConfig,
> = z.ZodObject<
  TConfig['shape'] & {
    type: z.ZodLiteral<TName>
  }
>

type FrpMessageGroupDefinitions<TMessages extends FrpMessageGroupConfig> = {
  [K in keyof TMessages]: K extends string ? FrpMessageDefinitionFromConfig<K, TMessages[K]> : never
}

type FrpStreamDefinitions<TStreams extends Record<string, FrpMessageGroupConfig>> = {
  [K in keyof TStreams]: FrpMessageGroupDefinitions<TStreams[K]>
}

type PrefixKeys<TPrefix extends string, TRecord extends Record<string, unknown>> = {
  [K in keyof TRecord as K extends string ? `${TPrefix}.${K}` : never]: TRecord[K]
}

type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never

type NestedPathObject<TPath extends string, TValue> = TPath extends `${infer THead}.${infer TTail}`
  ? { [K in THead]: NestedPathObject<TTail, TValue> }
  : { [K in TPath]: TValue }

type DeepPartialObject<TValue> = TValue extends (...args: infer TArgs) => infer TResult
  ? (...args: TArgs) => TResult
  : {
      [K in keyof TValue]?: DeepPartialObject<TValue[K]>
    }

type CommandClientFunction<TDefinition> = (
  args: UnaryRpcParts<TDefinition>['args'] & PortRpcClientOptions,
) => Promise<UnaryRpcParts<TDefinition>['result']>

type NestedProtocolClient<TCommands> =
  TCommands extends Record<string, unknown>
    ? UnionToIntersection<
        {
          [TName in keyof TCommands & string]: NestedPathObject<
            TName,
            CommandClientFunction<TCommands[TName]>
          >
        }[keyof TCommands & string]
      >
    : EmptyObject

type AvailableCommandClientEntry<TCommands, Tx, Rx, TName extends keyof TCommands & string> =
  MessageUnionIncludes<Tx, UnaryRpcParts<TCommands[TName]>['request']> extends true
    ? [UnaryRpcParts<TCommands[TName]>['result']] extends [void]
      ? NestedPathObject<TName, CommandClientFunction<TCommands[TName]>>
      : MessageUnionIncludes<Rx, UnaryRpcParts<TCommands[TName]>['response']> extends true
        ? NestedPathObject<TName, CommandClientFunction<TCommands[TName]>>
        : never
    : never

type CommandServerHandler<TProtocol, TDefinition> = (
  request: ProtocolEnvelope<TProtocol> & UnaryRpcParts<TDefinition>['request'],
) => UnaryRpcParts<TDefinition>['result'] | Promise<UnaryRpcParts<TDefinition>['result']>

type NestedProtocolServerHandlers<TProtocol> = TProtocol extends {
  commands: infer TCommands
}
  ? DeepPartialObject<
      UnionToIntersection<
        {
          [TName in keyof TCommands & string]: NestedPathObject<
            TName,
            CommandServerHandler<TProtocol, TCommands[TName]>
          >
        }[keyof TCommands & string]
      >
    >
  : EmptyObject

type RuntimeProtocolMessageDefinition = {
  safeParse: (value: unknown) => { success: boolean }
}

type RuntimeProtocolDefinition = {
  envelope: RuntimeProtocolMessageDefinition | undefined
  commands: Record<
    string,
    {
      request: RuntimeProtocolMessageDefinition
      response: RuntimeProtocolMessageDefinition
    }
  >
  streams: Record<string, Record<string, RuntimeProtocolMessageDefinition>>
}

const hasCommandResponse = (
  config: FrpCommandConfig,
): config is FrpCommandConfig<z.ZodObject<z.ZodRawShape>, z.ZodType> => {
  return config.response !== undefined
}

const createUnaryCommandDefinition = <
  const TName extends string,
  const TConfig extends FrpCommandConfig,
>(
  name: TName,
  config: TConfig,
): CommandDefinitionFromConfig<TName, TConfig> => {
  const requestType = `${name}Request`
  const responseType = `${name}Response`
  const request = z
    .object({
      ...config.request.shape,
      type: z.literal(requestType),
      requestId: z.string(),
    })
    .describe(config.request.description ?? '') as CommandDefinitionFromConfig<
    TName,
    TConfig
  >['request']

  const responseSchema = hasCommandResponse(config) ? config.response : undefined
  const responseShape = responseSchema
    ? {
        type: z.literal(responseType),
        requestId: z.string(),
        result: responseSchema.optional(),
        error: rpcErrorSchema.optional(),
      }
    : {
        type: z.literal(responseType),
        requestId: z.string(),
        error: rpcErrorSchema.optional(),
      }
  const responseObject = z.object(responseShape)
  const responseSchemaWithResult = responseSchema
    ? responseObject.refine(
        (value) => 'result' in value !== (value.error !== undefined),
        'Command response must contain exactly one result or error.',
      )
    : responseObject
  const response = responseSchemaWithResult.describe(
    config.response?.description ?? '',
  ) as CommandDefinitionFromConfig<TName, TConfig>['response']

  return {
    name,
    request,
    response,
    defaultTimeoutMs: config.defaultTimeoutMs,
    createRequest: (args, requestId) =>
      request.parse({
        ...args,
        type: requestType,
        requestId,
      }) as CommandRequestFromConfig<TName, TConfig>,
    createResponse: (receivedRequest, result) => {
      const responsePayload = hasCommandResponse(config)
        ? {
            type: responseType,
            requestId: receivedRequest.requestId,
            result,
          }
        : {
            type: responseType,
            requestId: receivedRequest.requestId,
          }
      return response.parse(responsePayload) as CommandResponseFromConfig<TName, TConfig>
    },
    createErrorResponse: (receivedRequest, error) =>
      response.parse({
        type: responseType,
        requestId: receivedRequest.requestId,
        error: serializeRemoteError(error),
      }) as CommandResponseFromConfig<TName, TConfig>,
    isResponseForRequest: (receivedResponse, requestId) => receivedResponse.requestId === requestId,
    readResponse: (receivedResponse) => {
      if ('error' in receivedResponse && receivedResponse.error) {
        return {
          ok: false,
          error: hydrateRemoteError(rpcErrorSchema.parse(receivedResponse.error)),
        }
      }
      return {
        ok: true,
        value: (hasCommandResponse(config) && 'result' in receivedResponse
          ? receivedResponse.result
          : undefined) as CommandResultFromConfig<TConfig>,
      }
    },
  }
}

const createMessageDefinition = <
  const TName extends string,
  const TConfig extends FrpMessageConfig,
>(
  name: TName,
  config: TConfig,
): FrpMessageDefinitionFromConfig<TName, TConfig> =>
  z.object({
    ...config.shape,
    type: z.literal(name),
  }) as FrpMessageDefinitionFromConfig<TName, TConfig>

const createStreamDefinitions = <const TStreams extends Record<string, FrpMessageGroupConfig>>(
  streams: TStreams,
): FrpStreamDefinitions<TStreams> => {
  const streamDefinitions: Partial<FrpStreamDefinitions<TStreams>> = {}
  const streamEntries = Object.entries(streams) as Array<
    [keyof TStreams & string, TStreams[keyof TStreams & string]]
  >
  for (const [streamName, messages] of streamEntries) {
    const messageDefinitions: Partial<FrpMessageGroupDefinitions<typeof messages>> = {}
    const messageEntries = Object.entries(messages) as Array<
      [keyof typeof messages & string, (typeof messages)[keyof typeof messages & string]]
    >
    for (const [messageName, messageConfig] of messageEntries) {
      messageDefinitions[messageName] = createMessageDefinition(
        messageName,
        messageConfig,
      ) as FrpMessageGroupDefinitions<typeof messages>[typeof messageName]
    }
    streamDefinitions[streamName] =
      messageDefinitions as FrpStreamDefinitions<TStreams>[typeof streamName]
  }
  return streamDefinitions as FrpStreamDefinitions<TStreams>
}

type PrefixedCommandDefinitions<
  TPrefix extends string,
  TCommands extends Record<string, FrpCommandConfig>,
> = {
  [TName in keyof TCommands & string as `${TPrefix}.${TName}`]: CommandDefinitionFromConfig<
    `${TPrefix}.${TName}`,
    TCommands[TName]
  >
}

const createPrefixedProtocolName = <const TPrefix extends string, const TName extends string>(
  prefix: TPrefix,
  name: TName,
): `${TPrefix}.${TName}` => `${prefix}.${name}`

const createPrefixedCommandDefinitions = <
  const TPrefix extends string,
  const TCommands extends Record<string, FrpCommandConfig>,
>(
  prefix: TPrefix,
  commands: TCommands,
): PrefixedCommandDefinitions<TPrefix, TCommands> => {
  const commandDefinitions = {} as PrefixedCommandDefinitions<TPrefix, TCommands>
  const writableCommandDefinitions = commandDefinitions as Record<
    string,
    CommandDefinitionFromConfig<`${TPrefix}.${string}`, TCommands[keyof TCommands & string]>
  >
  const entries = Object.entries(commands) as Array<
    [keyof TCommands & string, TCommands[keyof TCommands & string]]
  >
  for (const [name, config] of entries) {
    const prefixedName = createPrefixedProtocolName(prefix, name)
    writableCommandDefinitions[prefixedName] = createUnaryCommandDefinition(prefixedName, config)
  }
  return commandDefinitions
}

const createPrefixedStreamDefinitions = <
  const TPrefix extends string,
  const TStreams extends Record<string, FrpMessageGroupConfig>,
>(
  prefix: TPrefix,
  streams: TStreams,
): PrefixKeys<TPrefix, FrpStreamDefinitions<TStreams>> =>
  prefixRecordKeys(prefix, createStreamDefinitions(streams))

const prefixRecordKeys = <
  const TPrefix extends string,
  const TRecord extends Record<string, unknown>,
>(
  prefix: TPrefix,
  record: TRecord,
): PrefixKeys<TPrefix, TRecord> => {
  const prefixed = {} as PrefixKeys<TPrefix, TRecord>
  const writablePrefixed = prefixed as Record<string, TRecord[keyof TRecord]>
  const entries = Object.entries(record) as Array<[keyof TRecord & string, TRecord[keyof TRecord]]>
  for (const [key, value] of entries) {
    writablePrefixed[`${prefix}.${key}`] = value
  }
  return prefixed
}

const setNestedPathValue = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.')
  let current = target
  for (const part of parts.slice(0, -1)) {
    const existing = current[part]
    if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
      current = existing as Record<string, unknown>
      continue
    }
    const next: Record<string, unknown> = {}
    current[part] = next
    current = next
  }
  const leaf = parts.at(-1)
  if (!leaf) throw new Error(`Cannot create protocol client entry for empty command path "${path}"`)
  current[leaf] = value
}

const getNestedPathValue = (source: unknown, path: string): unknown => {
  let current = source
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export type FrpProtocolDefinition<
  TCommands extends Record<string, unknown>,
  TStreams extends Record<string, unknown> = EmptyObject,
  TEnvelope extends z.ZodType | undefined = undefined,
> = {
  id: string
  version: string
  envelope: TEnvelope
  commands: TCommands
  streams: TStreams
  message: z.ZodType
}

type ProtocolCommandRequests<TProtocol> = TProtocol extends {
  commands: infer TCommands
}
  ? {
      [TName in keyof TCommands]: UnaryRpcParts<TCommands[TName]>['request']
    }[keyof TCommands]
  : never

type ProtocolCommandResponses<TProtocol> = TProtocol extends {
  commands: infer TCommands
}
  ? {
      [TName in keyof TCommands]: UnaryRpcParts<TCommands[TName]>['response']
    }[keyof TCommands]
  : never

type ProtocolStreamMessages<TProtocol> = TProtocol extends {
  streams: infer TStreams
}
  ? {
      [TStreamName in keyof TStreams]: TStreams[TStreamName] extends Record<string, z.ZodType>
        ? z.output<TStreams[TStreamName][keyof TStreams[TStreamName]]>
        : never
    }[keyof TStreams]
  : never

type ProtocolEnvelope<TProtocol> = TProtocol extends {
  envelope: z.ZodType
}
  ? z.output<TProtocol['envelope']>
  : EmptyObject

type UnaryRpcParts<TDefinition> =
  TDefinition extends UnaryPortRpcDefinition<
    infer TRequest,
    infer TResponse,
    infer TArgs,
    infer TResult,
    infer TRequestSchema,
    infer TResponseSchema
  >
    ? {
        request: TRequest
        response: TResponse
        args: TArgs
        result: TResult
        requestSchema: TRequestSchema
        responseSchema: TResponseSchema
      }
    : never

export type ProtocolMessage<TProtocol> = ProtocolEnvelope<TProtocol> &
  (
    | ProtocolCommandRequests<TProtocol>
    | ProtocolCommandResponses<TProtocol>
    | ProtocolStreamMessages<TProtocol>
  )

export function parseProtocolMessage<
  TProtocol extends FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    z.ZodType | undefined
  >,
>(protocol: TProtocol, value: unknown): ProtocolMessage<TProtocol> {
  return protocol.message.parse(value) as ProtocolMessage<TProtocol>
}

export type ProtocolClient<TProtocol> = TProtocol extends {
  commands: infer TCommands
}
  ? NestedProtocolClient<TCommands>
  : EmptyObject

type MessageType<TMessage> = TMessage extends { type: infer TType } ? TType : never
type MessageUnionIncludes<TUnion, TMessage> = [
  Extract<MessageType<TMessage>, MessageType<TUnion>>,
] extends [never]
  ? false
  : true

export type ProtocolClientForPort<TProtocol, Tx, Rx> = TProtocol extends {
  commands: infer TCommands
}
  ? UnionToIntersection<
      {
        [TName in keyof TCommands & string]: AvailableCommandClientEntry<TCommands, Tx, Rx, TName>
      }[keyof TCommands & string]
    >
  : EmptyObject

export type ProtocolServerHandlers<TProtocol> = NestedProtocolServerHandlers<TProtocol>

export type ProtocolServerOptions = {
  onError?: (error: unknown) => void
  onUnhandledCommand?: (event: { command: string; request: { requestId: string } }) => void
  onUnknownMessage?: (message: unknown) => void
}

const createProtocolMessageSchema = <const TProtocol extends RuntimeProtocolDefinition>(
  protocol: TProtocol,
): z.ZodType<ProtocolMessage<TProtocol>> => {
  const messageDefinitions: RuntimeProtocolMessageDefinition[] = [
    ...Object.values(protocol.commands).flatMap((definition) => [
      definition.request,
      definition.response,
    ]),
    ...Object.values(protocol.streams).flatMap((messages) => Object.values(messages)),
  ]

  return z.custom<ProtocolMessage<TProtocol>>((value) => {
    if (protocol.envelope && !protocol.envelope.safeParse(value).success) return false
    return messageDefinitions.some((definition) => definition.safeParse(value).success)
  })
}

export function defineFrpProtocol<
  const TCommands extends Record<string, FrpCommandConfig> = EmptyObject,
  const TStreams extends Record<string, FrpMessageGroupConfig> = EmptyObject,
  const TEnvelope extends z.ZodType | undefined = undefined,
>(definition: {
  id: string
  version: string
  envelope?: TEnvelope
  commands?: TCommands
  streams?: TStreams
}): FrpProtocolDefinition<
  FrpCommandDefinitions<TCommands>,
  FrpStreamDefinitions<TStreams>,
  TEnvelope
> {
  const commandDefinitions: Partial<FrpCommandDefinitions<TCommands>> = {}
  const entries = Object.entries(definition.commands ?? {}) as Array<
    [keyof TCommands & string, TCommands[keyof TCommands & string]]
  >
  for (const [name, config] of entries) {
    commandDefinitions[name] = createUnaryCommandDefinition(
      name,
      config,
    ) as FrpCommandDefinitions<TCommands>[typeof name]
  }
  const commands = commandDefinitions as FrpCommandDefinitions<TCommands>
  const streams = createStreamDefinitions((definition.streams ?? {}) as TStreams)
  return {
    ...definition,
    envelope: definition.envelope as TEnvelope,
    commands,
    streams,
    message: createProtocolMessageSchema({
      envelope: definition.envelope,
      commands,
      streams,
    }),
  }
}

export function defineFrpServiceProtocol<
  const TService extends string,
  const TCommands extends Record<string, FrpCommandConfig> = EmptyObject,
  const TStreams extends Record<string, FrpMessageGroupConfig> = EmptyObject,
  const TEnvelope extends z.ZodType | undefined = undefined,
>(definition: {
  service: TService
  id?: string
  version: string
  envelope?: TEnvelope
  commands?: TCommands
  streams?: TStreams
}): FrpProtocolDefinition<
  PrefixedCommandDefinitions<TService, TCommands>,
  PrefixKeys<TService, FrpStreamDefinitions<TStreams>>,
  TEnvelope
> {
  const commands = createPrefixedCommandDefinitions(
    definition.service,
    definition.commands ?? ({} as TCommands),
  )
  const streams = createPrefixedStreamDefinitions(
    definition.service,
    definition.streams ?? ({} as TStreams),
  )
  const protocol = {
    id: definition.id ?? `taskyon.${definition.service}`,
    version: definition.version,
    envelope: definition.envelope as TEnvelope,
    commands,
    streams,
  }
  return {
    ...protocol,
    message: createProtocolMessageSchema(protocol),
  }
}

export function mergeFrpProtocols<
  const TBase extends FrpProtocolDefinition<
    RuntimeProtocolDefinition['commands'],
    RuntimeProtocolDefinition['streams'],
    z.ZodType | undefined
  >,
  const TExtension extends FrpProtocolDefinition<
    RuntimeProtocolDefinition['commands'],
    RuntimeProtocolDefinition['streams'],
    z.ZodType | undefined
  >,
>(definition: {
  id: string
  version: string
  base: TBase
  extension: TExtension
}): FrpProtocolDefinition<
  TBase['commands'] & TExtension['commands'],
  TBase['streams'] & TExtension['streams'],
  TExtension['envelope']
> {
  const commands = {
    ...definition.base.commands,
    ...definition.extension.commands,
  } as TBase['commands'] & TExtension['commands']
  const streams = {
    ...definition.base.streams,
    ...definition.extension.streams,
  } as TBase['streams'] & TExtension['streams']
  return {
    id: definition.id,
    version: definition.version,
    envelope: definition.extension.envelope,
    commands,
    streams,
    message: createProtocolMessageSchema({
      envelope: definition.extension.envelope,
      commands,
      streams,
    }),
  }
}

export const createProtocolPort = <
  TProtocol extends FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    z.ZodType | undefined
  >,
>(
  _protocol: TProtocol,
): DuplexChannel<ProtocolMessage<TProtocol>, ProtocolMessage<TProtocol>> => {
  void _protocol
  return createDuplexChannel<ProtocolMessage<TProtocol>, ProtocolMessage<TProtocol>>()
}

type RuntimeRpcDefinition = {
  name: string
  defaultTimeoutMs?: number | undefined
  request: { safeParse: (value: unknown) => { success: boolean; data?: { requestId: string } } }
  response: { safeParse: (value: unknown) => { success: boolean; data?: { requestId: string } } }
  createRequest: (args: Record<string, unknown>, requestId: string) => { requestId: string }
  createResponse: (request: { requestId: string }, result: unknown) => { requestId: string }
  createErrorResponse: (request: { requestId: string }, error: unknown) => { requestId: string }
  isResponseForRequest: (response: { requestId: string }, requestId: string) => boolean
  readResponse: (response: { requestId: string }) => RpcResponseResult<unknown>
  createCancelRequest?: (request: { requestId: string }, reason: string) => { requestId: string }
}

const createRuntimePortRpcClient = <Tx, Rx>(
  port: RpcMessagePort<Tx, Rx>,
  definition: RuntimeRpcDefinition,
  options: PortClientOptions = {},
) => {
  return async (args: Record<string, unknown> & PortRpcClientOptions): Promise<unknown> => {
    if (!options.skipBeforeRequestFor?.includes(definition.name)) {
      await options.beforeRequest?.({ command: definition.name, args })
    }
    const requestId = createPortRpcRequestId(definition.name)
    const request = definition.createRequest(args, requestId)
    const portRequest = request as Tx
    const createCancelRequest = definition.createCancelRequest
    return await createStreamRpcRequest<Tx, { requestId: string }, unknown, never, Rx>({
      port,
      request: portRequest,
      requestId,
      timeoutMs: args.timeoutMs ?? definition.defaultTimeoutMs ?? 30_000,
      signal: args.signal,
      createCancelRequest: createCancelRequest
        ? (reason) => createCancelRequest(request, reason) as Tx
        : undefined,
      parseResponse: (message) => {
        const parsed = definition.response.safeParse(message)
        return parsed.success ? parsed.data : undefined
      },
      isResponseForRequest: definition.isResponseForRequest,
      readResponse: definition.readResponse,
    })
  }
}

const createConventionPortRpcClient = <Tx extends { type: string; requestId: string }, Rx>(
  port: RpcMessagePort<Tx, Rx>,
  name: string,
) => {
  return async (args: Record<string, unknown> & PortRpcClientOptions): Promise<unknown> => {
    const requestId = createPortRpcRequestId(name)
    const { timeoutMs, signal, ...payload } = args
    const request = {
      ...payload,
      type: `${name}Request`,
      requestId,
    } as Tx
    const responseType = `${name}Response`
    return await createStreamRpcRequest<
      Tx,
      { type: string; requestId: string; result?: unknown },
      unknown,
      never,
      Rx
    >({
      port,
      request,
      requestId,
      timeoutMs: timeoutMs ?? 30_000,
      signal,
      parseResponse: (message) => {
        if (typeof message !== 'object' || message === null) return undefined
        if (!('type' in message) || !('requestId' in message)) return undefined
        if (message.type !== responseType || message.requestId !== requestId) return undefined
        return message as { type: string; requestId: string; result?: unknown }
      },
      isResponseForRequest: (response, currentRequestId) => response.requestId === currentRequestId,
      readResponse: (response) => ({
        ok: true,
        value: 'result' in response ? response.result : undefined,
      }),
    })
  }
}

export function createPortClient<Tx extends { type: string; requestId: string }, Rx>(
  port: RpcMessagePort<Tx, Rx>,
): PortClientFromMessages<Tx, Rx>
export function createPortClient<
  Rx,
  const TProtocol extends FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    z.ZodType | undefined
  >,
>(
  port: RpcMessagePort<ProtocolMessage<TProtocol>, Rx>,
  protocol: TProtocol,
  options?: PortClientOptions,
): ProtocolClient<TProtocol>
export function createPortClient<
  Tx,
  Rx,
  const TProtocol extends FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    z.ZodType | undefined
  >,
>(
  port: RpcMessagePort<Tx, Rx>,
  protocol: TProtocol,
  options?: PortClientOptions,
): ProtocolClientForPort<TProtocol, Tx, Rx>
export function createPortClient(
  port: RpcMessagePort<never, unknown>,
  protocol?: FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    z.ZodType | undefined
  >,
  options: PortClientOptions = {},
): unknown {
  if (protocol) {
    const client: Record<string, unknown> = {}
    for (const [name, definition] of Object.entries(protocol.commands)) {
      setNestedPathValue(
        client,
        name,
        createRuntimePortRpcClient(port, definition as RuntimeRpcDefinition, options),
      )
    }
    return client
  }

  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property !== 'string') return undefined
        return createConventionPortRpcClient(
          port as RpcMessagePort<{ type: string; requestId: string }, unknown>,
          property,
        )
      },
    },
  )
}

export function createPortServer<
  Tx,
  Rx,
  const TProtocol extends FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    z.ZodType | undefined
  >,
>(
  port: Port<Tx, Rx>,
  protocol: TProtocol,
  handlers: ProtocolServerHandlers<TProtocol>,
  options: ProtocolServerOptions = {},
): Unsubscribe {
  const commandEntries = Object.entries(protocol.commands) as Array<
    [keyof TProtocol['commands'] & string, RuntimeRpcDefinition]
  >
  const knownMessageDefinitions: RuntimeProtocolMessageDefinition[] = [
    ...commandEntries.map(([, definition]) => definition.response),
    ...Object.values(protocol.streams).flatMap((messages) =>
      Object.values(messages as Record<string, RuntimeProtocolMessageDefinition>),
    ),
  ]
  const runtimeHandlers = handlers as Record<
    string,
    ((request: { requestId: string }) => unknown) | undefined
  >

  return port.receive((raw) => {
    for (const [name, definition] of commandEntries) {
      const parsed = definition.request.safeParse(raw)
      if (!parsed.success || !parsed.data) continue
      const request = parsed.data

      const nestedHandler = getNestedPathValue(runtimeHandlers, name)
      const handler =
        typeof nestedHandler === 'function'
          ? (nestedHandler as (request: { requestId: string }) => unknown)
          : undefined
      if (!handler) {
        options.onUnhandledCommand?.({ command: name, request })
        return
      }

      void Promise.resolve()
        .then(() => handler(request))
        .then((result) => {
          port.send(definition.createResponse(request, result) as Tx)
        })
        .catch((error) => {
          if (options.onError) options.onError(error)
          else console.error('An error occurred while handling a protocol command.', error)
          port.send(definition.createErrorResponse(request, error) as Tx)
        })
      return
    }
    if (knownMessageDefinitions.some((definition) => definition.safeParse(raw).success)) return
    options.onUnknownMessage?.(raw)
  })
}

export function createStreamRpcRequest<
  TRequest,
  TResponse,
  TResult,
  TScope,
  TReceive = unknown,
>(options: {
  port: RpcMessagePort<TRequest, TReceive>
  request: TRequest
  requestId: string
  timeoutMs: number
  signal?: AbortSignal | undefined
  scope?: TScope | undefined
  scopeStore?: RpcScopeStore<TScope> | undefined
  createCancelRequest?: ((reason: string) => TRequest) | undefined
  parseResponse: (message: TReceive) => TResponse | undefined
  isResponseForRequest: (response: TResponse, requestId: string) => boolean
  readResponse: (response: TResponse) => RpcResponseResult<TResult>
}): Promise<TResult> {
  if (options.scope !== undefined) options.scopeStore?.set(options.requestId, options.scope)
  const createCancelRequest = options.createCancelRequest
  return awaitRequestResponse({
    subscribe: options.port.receive,
    sendRequest: () => options.port.send(options.request),
    requestLabel: options.requestId,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    sendCancel: createCancelRequest
      ? (reason) => options.port.send(createCancelRequest(reason))
      : undefined,
    readResponse: (message) => {
      const response = options.parseResponse(message)
      if (!response || !options.isResponseForRequest(response, options.requestId)) return undefined
      return options.readResponse(response)
    },
  }).finally(() => options.scopeStore?.delete(options.requestId))
}
