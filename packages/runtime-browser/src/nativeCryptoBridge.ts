import { z } from 'zod'
import {
  nativeDeviceError,
  parseNativeDeviceOpen,
  parseNativeSessionEnvelope,
  type NativeDeviceCommands,
} from './nativeCryptoSession'

const parseRequest = (value: unknown) => {
  const id = z.string().uuid()
  const handle = z.string().min(1).max(64)
  const publicKey = z.string().length(43)
  const envelope = z.string().max(128)
  return z
    .discriminatedUnion('operation', [
      z
        .object({ id, operation: z.literal('open'), bindingPublicKey: publicKey.optional() })
        .strict(),
      z
        .object({
          id,
          operation: z.literal('openSession'),
          handle,
          transportPublicKey: publicKey,
          wrappedSessionKey: envelope.optional(),
        })
        .strict(),
      z
        .object({
          id,
          operation: z.literal('importSession'),
          handle,
          transportPublicKey: publicKey,
          transportEnvelope: envelope,
        })
        .strict(),
      z.object({ id, operation: z.literal('close'), handle }).strict(),
    ])
    .parse(value)
}
type DeviceRequest = ReturnType<typeof parseRequest>
type DeviceRequestWithoutId = DeviceRequest extends infer R
  ? R extends DeviceRequest
    ? Omit<R, 'id'>
    : never
  : never

export const startNativeDeviceHost = (port: MessagePort, commands: NativeDeviceCommands) => {
  const handles = new Set<string>()
  let active = true
  const execute = async (request: DeviceRequest) => {
    if (request.operation === 'open') {
      const result = await commands.open(request.bindingPublicKey)
      if (!active) {
        await commands.close(result.handle)
        throw new Error('Closed')
      }
      handles.add(result.handle)
      return result
    }
    if (!handles.has(request.handle)) throw new Error('Unauthorized')
    switch (request.operation) {
      case 'openSession':
        return commands.openSession(
          request.handle,
          request.transportPublicKey,
          request.wrappedSessionKey,
        )
      case 'importSession':
        return commands.importSession(
          request.handle,
          request.transportPublicKey,
          request.transportEnvelope,
        )
      case 'close':
        await commands.close(request.handle)
        return undefined
    }
  }
  port.onmessage = (event: MessageEvent<unknown>) => {
    if (!active) return
    let request: DeviceRequest
    try {
      request = parseRequest(event.data)
    } catch {
      return
    }
    void execute(request).then(
      (result) => {
        if (active) port.postMessage({ id: request.id, result })
      },
      (error: unknown) => {
        if (active) port.postMessage({ id: request.id, error: nativeDeviceError(error) })
      },
    )
  }
  port.start()
  return async () => {
    if (!active) return
    active = false
    port.close()
    await Promise.all([...handles].map((handle) => commands.close(handle)))
    handles.clear()
  }
}

export const createNativeDeviceRequester = (port: MessagePort) => {
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let closed = false
  port.onmessage = (event: MessageEvent<unknown>) => {
    const response = z
      .object({
        id: z.string().uuid(),
        result: z.unknown().optional(),
        error: z.string().optional(),
      })
      .safeParse(event.data)
    if (!response.success) return
    const entry = pending.get(response.data.id)
    pending.delete(response.data.id)
    if (response.data.error) entry?.reject(new Error(response.data.error))
    else entry?.resolve(response.data.result)
  }
  port.start()
  const request = <T>(
    message: DeviceRequestWithoutId,
    parse: (value: unknown) => T,
  ): Promise<T> => {
    if (closed) return Promise.reject(new Error('Closed'))
    return new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID()
      pending.set(id, { resolve, reject })
      port.postMessage({ ...message, id })
    }).then(parse)
  }
  const commands: NativeDeviceCommands = {
    open: (bindingPublicKey) =>
      request({ operation: 'open', bindingPublicKey }, parseNativeDeviceOpen),
    openSession: (handle, transportPublicKey, wrappedSessionKey) =>
      request(
        { operation: 'openSession', handle, transportPublicKey, wrappedSessionKey },
        parseNativeSessionEnvelope,
      ),
    importSession: (handle, transportPublicKey, transportEnvelope) =>
      request(
        { operation: 'importSession', handle, transportPublicKey, transportEnvelope },
        parseNativeSessionEnvelope,
      ),
    close: (handle) => request({ operation: 'close', handle }, () => undefined),
  }
  return {
    commands,
    stop: () => {
      closed = true
      pending.forEach(({ reject }) => reject(new Error('Closed')))
      pending.clear()
      port.close()
    },
  }
}
