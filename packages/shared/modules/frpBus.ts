// frpBus.ts
import { z } from 'zod'

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

export function MessageChannelBridge<Tx, Rx = Tx>(dport: Port<Tx, Rx>, mport: MessagePort) {
  const unsub = dport.receive((msg) => mport.postMessage(msg))
  mport.onmessage = (msg) => dport.send(msg.data)

  const destroy = () => {
    unsub()
    mport.close()
  }

  return { destroy }
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

type CommandResponseShapeFromConfig<TName extends string, TConfig extends FrpCommandConfig> = {
  type: z.ZodLiteral<`${TName}Response`>
  requestId: z.ZodString
} & (TConfig extends { response: z.ZodType } ? { result: TConfig['response'] } : EmptyObject)

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

  const responseShape = hasCommandResponse(config)
    ? {
        type: z.literal(responseType),
        requestId: z.string(),
        result: config.response,
      }
    : {
        type: z.literal(responseType),
        requestId: z.string(),
      }
  const response = z
    .object(responseShape)
    .describe(config.response?.description ?? '') as CommandDefinitionFromConfig<
    TName,
    TConfig
  >['response']

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
    isResponseForRequest: (receivedResponse, requestId) => receivedResponse.requestId === requestId,
    readResponse: (receivedResponse) => ({
      ok: true,
      value: (hasCommandResponse(config) && 'result' in receivedResponse
        ? receivedResponse.result
        : undefined) as CommandResultFromConfig<TConfig>,
    }),
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

export type ProtocolClient<TProtocol> = TProtocol extends {
  commands: infer TCommands
}
  ? {
      [TName in keyof TCommands]: (
        args: UnaryRpcParts<TCommands[TName]>['args'] & PortRpcClientOptions,
      ) => Promise<UnaryRpcParts<TCommands[TName]>['result']>
    }
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
  ? {
      [TName in keyof TCommands as MessageUnionIncludes<
        Tx,
        UnaryRpcParts<TCommands[TName]>['request']
      > extends true
        ? [UnaryRpcParts<TCommands[TName]>['result']] extends [void]
          ? TName
          : MessageUnionIncludes<Rx, UnaryRpcParts<TCommands[TName]>['response']> extends true
            ? TName
            : never
        : never]: (
        args: UnaryRpcParts<TCommands[TName]>['args'] & PortRpcClientOptions,
      ) => Promise<UnaryRpcParts<TCommands[TName]>['result']>
    }
  : EmptyObject

export type ProtocolServerHandlers<TProtocol> = TProtocol extends {
  commands: infer TCommands
}
  ? {
      [TName in keyof TCommands]?: (
        request: ProtocolEnvelope<TProtocol> & UnaryRpcParts<TCommands[TName]>['request'],
      ) =>
        | UnaryRpcParts<TCommands[TName]>['result']
        | Promise<UnaryRpcParts<TCommands[TName]>['result']>
    }
  : EmptyObject

export type ProtocolServerOptions = {
  onError?: (error: unknown) => void
  onUnhandledCommand?: (event: { command: string; request: { requestId: string } }) => void
  onUnknownMessage?: (message: unknown) => void
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
  return {
    ...definition,
    envelope: definition.envelope as TEnvelope,
    commands: commandDefinitions as FrpCommandDefinitions<TCommands>,
    streams: createStreamDefinitions((definition.streams ?? {}) as TStreams),
  }
}

export function mergeFrpProtocols<
  const TBase extends FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    z.ZodType | undefined
  >,
  const TExtension extends FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
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
  return {
    id: definition.id,
    version: definition.version,
    envelope: definition.extension.envelope,
    commands: {
      ...definition.base.commands,
      ...definition.extension.commands,
    },
    streams: {
      ...definition.base.streams,
      ...definition.extension.streams,
    },
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
  isResponseForRequest: (response: { requestId: string }, requestId: string) => boolean
  readResponse: (response: { requestId: string }) => RpcResponseResult<unknown>
  createCancelRequest?: (request: { requestId: string }, reason: string) => { requestId: string }
}

type RuntimeProtocolMessageDefinition = {
  safeParse: (value: unknown) => { success: boolean }
}

const createRuntimePortRpcClient = <Tx, Rx>(
  port: RpcMessagePort<Tx, Rx>,
  definition: RuntimeRpcDefinition,
) => {
  return async (args: Record<string, unknown> & PortRpcClientOptions): Promise<unknown> => {
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
): ProtocolClient<TProtocol>
export function createPortClient<
  Tx,
  Rx,
  const TProtocol extends FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    z.ZodType | undefined
  >,
>(port: RpcMessagePort<Tx, Rx>, protocol: TProtocol): ProtocolClientForPort<TProtocol, Tx, Rx>
export function createPortClient(
  port: RpcMessagePort<never, unknown>,
  protocol?: FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    z.ZodType | undefined
  >,
): unknown {
  if (protocol) {
    const client: Record<
      string,
      (args: Record<string, unknown> & PortRpcClientOptions) => Promise<unknown>
    > = {}
    for (const [name, definition] of Object.entries(protocol.commands)) {
      client[name] = createRuntimePortRpcClient(port, definition as RuntimeRpcDefinition)
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

      const handler = runtimeHandlers[name]
      if (!handler) {
        options.onUnhandledCommand?.({ command: name, request })
        return
      }

      void Promise.resolve(handler(request))
        .then((result) => {
          port.send(definition.createResponse(request, result) as Tx)
        })
        .catch((error) => {
          if (options.onError) options.onError(error)
          else console.error('an error occured during handling of the protocol command', error)
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

  const responsePromise = new Promise<TResult>((resolve, reject) => {
    let settled = false
    let unsubscribe: Unsubscribe = () => {}

    const cleanup = () => {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      options.scopeStore?.delete(options.requestId)
      unsubscribe()
    }

    const finish = (result: RpcResponseResult<TResult>) => {
      if (settled) return
      settled = true
      cleanup()
      if (result.ok) resolve(result.value)
      else reject(result.error)
    }

    const cancel = (reason: string) => {
      if (options.createCancelRequest) options.port.send(options.createCancelRequest(reason))
    }

    const abort = () => {
      const reason =
        options.signal?.reason instanceof Error
          ? options.signal.reason.message
          : String(options.signal?.reason ?? 'RPC request aborted')
      cancel(reason)
      finish({ ok: false, error: new Error(reason) })
    }

    const timeout = setTimeout(() => {
      const message = `RPC request ${options.requestId} timed out after ${options.timeoutMs}ms`
      cancel(message)
      finish({ ok: false, error: new Error(message) })
    }, options.timeoutMs)

    if (options.signal?.aborted) {
      abort()
      return
    }

    options.signal?.addEventListener('abort', abort, { once: true })
    unsubscribe = options.port.receive((message) => {
      const response = options.parseResponse(message)
      if (!response || !options.isResponseForRequest(response, options.requestId)) return
      finish(options.readResponse(response))
    })
  })

  options.port.send(options.request)
  return responsePromise
}

// ---- MessagePort <-> FRP bridge ------------------------------------------

export interface PortBridge<T> {
  /** Stream that mirrors everything coming from the external port */
  stream: Stream<T>
  /** Post into the bus (will also be forwarded to the external port) */
  emit: (value: T) => void
  /** Give this to the iframe (or whatever) */
  port: MessagePort
  /** Cleanup listener, subscription & ports */
  destroy: () => void
}

/**
 * Creates a MessageChannel and wires one side into a new FRP stream.
 * - Anything the iframe posts arrives on `stream`
 * - Anything you `emit` (or any subscriber emits back into this stream) is posted out to the iframe
 */
export function createMessagePortBridge<T>(): PortBridge<T> {
  const { stream, emit } = createStream<T>()
  const { port1, port2 } = new MessageChannel()

  // Internal (hidden) side
  port2.start()
  const onMsg = (e: MessageEvent<T>) => emit(e.data)
  port2.addEventListener('message', onMsg)

  // Forward stream values out to the external side
  const unsub: Unsubscribe | Promise<Unsubscribe> = stream((v) => {
    // Structured clone is required; assume T is cloneable.
    port2.postMessage(v)
  })

  const destroy = () => {
    unsub()
    port2.removeEventListener('message', onMsg)
    port1.close()
    port2.close()
  }

  return { stream, emit, port: port1, destroy }
}

export function createMessagePortAdapter<T>(stream: Stream<T>) {
  const { port1, port2 } = new MessageChannel()

  // Internal (hidden) side
  port2.start()
  // Forward stream values out to the external side
  const unsub: Unsubscribe = stream((v) => {
    // Structured clone is required; assume T is cloneable.
    port2.postMessage(v)
  })

  const destroy = () => {
    unsub()
    port1.close()
    port2.close()
  }

  return { port: port1, destroy }
}

// ---- Simple IFrame <-> FRP adapter ---------------------------------------

export function iframeBridge(
  iframe: HTMLIFrameElement,
  origin: string | null = null, // pass null to skip origin check
) {
  const win = iframe.contentWindow
  if (!win) throw new Error('iframe has no contentWindow')

  const inferred = iframe.src ? new URL(iframe.src, window.location.href).origin : 'null' // about:srcdoc
  const expectedOrigin = origin === undefined ? inferred : origin
  const checkOrigin = expectedOrigin !== null

  const { stream, emit } = createStream<unknown>()

  const onMessage = (ev: MessageEvent<unknown>) => {
    if (ev.source !== win) return
    if (checkOrigin && ev.origin !== expectedOrigin) return
    emit(ev.data)
  }
  window.addEventListener('message', onMessage)

  const post = (msg: unknown) => {
    // If iframe navigated, silently drop
    if (iframe.contentWindow === win) {
      win.postMessage(msg, expectedOrigin ?? '*')
    }
  }

  const destroy = () => window.removeEventListener('message', onMessage)

  return { stream, emit: post, destroy }
}

// ---- IFrame Multiplexer --------------------------------------------------

export type BusMsg<I extends string | number | symbol = string> = { id: I; payload: unknown }

export type TaskMessageStream = Stream<BusMsg>

interface Entry {
  ref: WeakRef<HTMLIFrameElement>
  post: (m: unknown) => void
}

// TODO: add a "bus" to the iframe...
/**
 * Create a multiplexer for bidirectional messaging between the host window
 * and multiple managed iframes. Each iframe is registered under an identifier,
 * and incoming `postMessage` events are routed to a typed stream keyed by id.
 *
 * Features:
 * - `attachIframe(id, iframe, origin?)`: register an iframe with a unique id.
 *   - Tracks the iframe with a `WeakRef`, cleaned up automatically if removed.
 *   - Determines expected origin from the iframe's `src` unless overridden.
 * - `send(id, msg)`: post a message to the iframe associated with `id`.
 *   - Messages are dropped if the iframe is disconnected or garbage collected.
 * - `all$`: a reactive stream of all incoming messages of the form `{ id, payload }`.
 * - Automatic garbage collection:
 *   - Uses `WeakRef` + `WeakMap` to avoid leaks.
 *   - Periodically sweeps stale entries after `sweepEvery` attaches.
 *   - Falls back to manual `gc()` to force a sweep.
 * - `detachId(id)`: manually detach an iframe by id.
 * - `destroy()`: stop listening to window `message` events and clear state.
 *
 * Notes:
 * - `winToId` is a `WeakMap` → iframe window references do not prevent GC.
 * - Origins:
 *   - If the iframe has `srcdoc` or `about:srcdoc`, origin is `"null"` and messages
 *     are sent with target `"*"`.
 *   - Otherwise the origin is inferred from the iframe `src` or overridden via `origin`.
 *
 * @param sweepEvery number of iframe attaches before scheduling a GC sweep (default: 5).
 * @returns API object: `{ all$, send, attachIframe, detachId, gc, destroy }`.
 */
export function createIframeMux<I extends string | number | symbol = string>(sweepEvery = 5) {
  const { stream: all$, emit } = createStream<BusMsg<I>>()

  const winToId = new WeakMap<Window, I>()
  const idToEntry = new Map<I, Entry>()
  let attachCountSinceSweep = 0

  const onMessage = (ev: MessageEvent) => {
    const id = winToId.get(ev.source as Window)
    if (!id) return
    emit({ id, payload: ev.data })
  }
  window.addEventListener('message', onMessage)

  const attachIframe = (id: I, iframe: HTMLIFrameElement, origin?: string) => {
    const win = iframe.contentWindow
    if (!win) throw new Error('iframe has no contentWindow')

    winToId.set(win, id)

    // Infer origin unless caller overrides. srcdoc/about:srcdoc => "null"
    const inferred =
      iframe.src && iframe.src !== 'about:srcdoc'
        ? new URL(iframe.src, window.location.href).origin
        : 'null'

    const expected = origin ?? inferred
    const postTarget = expected === 'null' ? '*' : expected

    const entry: Entry = {
      ref: new WeakRef(iframe),
      post: (msg: unknown) => {
        const el = entry.ref.deref()
        if (!el || el.contentWindow !== win) return // silently drop
        win.postMessage(msg, postTarget)
      },
    }

    idToEntry.set(id, entry)

    if (++attachCountSinceSweep >= sweepEvery) {
      attachCountSinceSweep = 0
      scheduleSweep()
    }
  }

  const send = (id: I, msg: unknown) => {
    const e = idToEntry.get(id)
    if (!e) return
    const el = e.ref.deref()
    if (!el || !el.isConnected) {
      detachId(id)
      return
    }
    e.post(msg)
  }

  const detachId = (id: I) => {
    idToEntry.delete(id)
    // winToId is a WeakMap → GC will clean it up
  }

  const sweep = () => {
    for (const [id, e] of idToEntry) {
      const el = e.ref.deref()
      if (!el || !el.isConnected) detachId(id)
    }
  }

  const scheduleSweep = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(sweep, { timeout: 200 })
    } else {
      setTimeout(sweep, 0)
    }
  }

  const gc = sweep

  const destroy = () => {
    window.removeEventListener('message', onMessage)
    idToEntry.clear()
    // WeakMaps auto-GC
  }

  return { all$, send, attachIframe, detachId, gc, destroy }
}

export type IframeMultiPlexer<I extends string | number | symbol = string> = ReturnType<
  typeof createIframeMux<I>
>

export function createUnavailableIframeMux<I extends string | number | symbol = string>(
  reason = 'Iframe message bridging is not available in this runtime.',
): IframeMultiPlexer<I> {
  const { stream: all$ } = createStream<BusMsg<I>>()
  const fail = () => {
    throw new Error(reason)
  }

  return {
    all$,
    send: fail,
    attachIframe: fail,
    detachId: () => {},
    gc: () => {},
    destroy: () => {
      all$.unsubscribeAll()
    },
  }
}
