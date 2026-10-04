import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import {
  parseNativeDeviceOpen,
  parseNativeSessionEnvelope,
  type NativeDeviceCommands,
} from '../nativeCryptoSession'
export const startNativeCryptoFixture = () => {
  const child = spawn(
    'cargo',
    [
      'test',
      '--locked',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      'native_crypto::tests::contract_server',
      '--',
      '--ignored',
      '--nocapture',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >()
  const failures: string[] = []
  child.stderr.on('data', (chunk: Buffer) => failures.push(chunk.toString()))
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    if (!line.startsWith('NATIVE_TEST_RESULT ')) return
    const response = z
      .object({
        id: z.string(),
        result: z.union([z.object({ Ok: z.unknown() }), z.object({ Err: z.string() })]),
      })
      .parse(JSON.parse(line.slice('NATIVE_TEST_RESULT '.length)))
    const entry = pending.get(response.id)
    pending.delete(response.id)
    if ('Err' in response.result) entry?.reject(new Error(response.result.Err))
    else entry?.resolve(response.result.Ok)
  })
  child.on('exit', (code) => {
    pending.forEach(({ reject }) =>
      reject(new Error(`Synthetic native fixture exited (${code}): ${failures.join('')}`)),
    )
    pending.clear()
  })
  const request = (operation: string, args: object = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID()
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ operation, id, ...args })}\n`)
    })
  const commands = (namespace: string): NativeDeviceCommands => ({
    open: (bindingPublicKey) =>
      request('open', { namespace, bindingPublicKey }).then(parseNativeDeviceOpen),
    openSession: (handle, transportPublicKey, wrappedSessionKey) =>
      request('openSession', { handle, transportPublicKey, wrappedSessionKey }).then(
        parseNativeSessionEnvelope,
      ),
    importSession: (handle, transportPublicKey, transportEnvelope) =>
      request('importSession', { handle, transportPublicKey, transportEnvelope }).then(
        parseNativeSessionEnvelope,
      ),
    close: async (handle) => {
      await request('close', { handle })
    },
  })
  return {
    commands,
    restart: () => request('restart'),
    stop: () => {
      child.stdin.end()
      lines.close()
    },
  }
}
