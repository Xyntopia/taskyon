import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { chromium, webkit } from '@playwright/test'
import { build } from 'esbuild'
import { z } from 'zod'
import { startNativeCryptoFixture } from './nativeCryptoFixture'

for (const [name, browserType] of Object.entries({ chromium, webkit })) {
  void test(`${name}: native ciphertext persistence survives browser restart in main and worker`, async () => {
    const fixture = startNativeCryptoFixture()
    const profile = await mkdtemp(join(tmpdir(), 'taskyon-native-crypto-'))
    const bundle = await build({
      stdin: {
        contents: `export * from './packages/runtime-browser/src/persistentCryptoSession'; export * from './packages/runtime-browser/src/nativeCryptoBridge';`,
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
    })
    const source = bundle.outputFiles[0]?.text
    assert.ok(source)
    const server = createServer((request, response) => {
      if (request.url === '/crypto.js') {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(source)
        return
      }
      if (request.method !== 'POST') {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Synthetic native crypto</title>')
        return
      }
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of request)
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        const payload = z
          .object({
            operation: z.enum(['open', 'openSession', 'importSession', 'close']),
            scope: z.enum(['main', 'worker']),
            bindingPublicKey: z.string().optional(),
            handle: z.string().optional(),
            transportPublicKey: z.string().optional(),
            wrappedSessionKey: z.string().optional(),
            transportEnvelope: z.string().optional(),
          })
          .parse(JSON.parse(Buffer.concat(chunks).toString()))
        const commands = fixture.commands(`synthetic-browser-${payload.scope}`)
        let result: unknown
        switch (payload.operation) {
          case 'open':
            result = await commands.open(payload.bindingPublicKey)
            break
          case 'openSession':
            result = await commands.openSession(
              z.string().parse(payload.handle),
              z.string().parse(payload.transportPublicKey),
              payload.wrappedSessionKey,
            )
            break
          case 'importSession':
            result = await commands.importSession(
              z.string().parse(payload.handle),
              z.string().parse(payload.transportPublicKey),
              z.string().parse(payload.transportEnvelope),
            )
            break
          case 'close':
            await commands.close(z.string().parse(payload.handle))
            result = null
            break
        }
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(result))
      })().catch(() => {
        response.statusCode = 500
        response.end('Synthetic native request failed')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const url = `http://127.0.0.1:${address.port}`
    let context: Awaited<ReturnType<typeof browserType.launchPersistentContext>> | undefined
    try {
      const results: { main: string; worker: string }[] = []
      for (const persist of [true, false]) {
        context = await browserType.launchPersistentContext(profile, { headless: true })
        const page = await context.newPage()
        await page.goto(url)
        // This synthetic harness runs the same owner in the window and a real module worker.
        const result = await page.evaluate(
          async ({ persist }) => {
            const moduleUrl = `${location.origin}/crypto.js`
            const { initCryptoSessionFromBrowser, startNativeDeviceHost } = await import(
              /* @vite-ignore */ moduleUrl
            )
            const commands = (scope: string) => {
              const send = async (operation: string, args: object = {}) => {
                const response = await fetch('/native', {
                  method: 'POST',
                  body: JSON.stringify({ operation, scope, ...args }),
                })
                if (!response.ok) throw new Error('Synthetic native request failed')
                return response.json()
              }
              return {
                open: (bindingPublicKey?: string) => send('open', { bindingPublicKey }),
                openSession: (
                  handle: string,
                  transportPublicKey: string,
                  wrappedSessionKey?: string,
                ) => send('openSession', { handle, transportPublicKey, wrappedSessionKey }),
                importSession: (
                  handle: string,
                  transportPublicKey: string,
                  transportEnvelope: string,
                ) => send('importSession', { handle, transportPublicKey, transportEnvelope }),
                close: (handle: string) => send('close', { handle }),
              }
            }
            const fixtureDatabase = async (name: string) =>
              new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open(name, 1)
                request.onupgradeneeded = () => request.result.createObjectStore('keys')
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(new Error('Synthetic database open failed'))
              })
            if (persist) {
              for (const name of ['CryptoSession_synthetic-main', 'CryptoSession_retired-agent']) {
                const legacy = await fixtureDatabase(name)
                await new Promise<void>((resolve, reject) => {
                  const transaction = legacy.transaction('keys', 'readwrite')
                  transaction.objectStore('keys').put(null, 'deviceKeyPair')
                  transaction.oncomplete = () => resolve()
                  transaction.onabort = () => reject(new Error('Legacy fixture write failed'))
                })
                legacy.close()
              }
              const unrelated = await fixtureDatabase('synthetic-unrelated-settings')
              await new Promise<void>((resolve, reject) => {
                const transaction = unrelated.transaction('keys', 'readwrite')
                transaction.objectStore('keys').put('retained settings', 'sentinel')
                transaction.oncomplete = () => resolve()
                transaction.onabort = () => reject(new Error('Unrelated fixture write failed'))
              })
              unrelated.close()
            }
            const session = await initCryptoSessionFromBrowser(undefined, persist, {
              namespace: 'synthetic-main',
              nativeDevice: commands('main'),
            })
            if (session.getSessionKey().extractable || 'getDeviceKey' in session)
              throw new Error('Native custody boundary failed')
            const main = await session.getSessionId()
            const wrapperId = await session.getWrapperId()
            const nativeRecords = await fixtureDatabase(
              'CryptoSession_native-device-v1:synthetic-main',
            )
            try {
              const recordKey = `sk_${wrapperId}`
              const record = await new Promise<unknown>((resolve, reject) => {
                const request = nativeRecords
                  .transaction('keys', 'readonly')
                  .objectStore('keys')
                  .get(recordKey)
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(new Error('Synthetic native record read failed'))
              })
              if (typeof record !== 'string') throw new Error('Native ciphertext record was lost')
              if (!persist) {
                // Restoration rewraps in memory; persist=false must retain the original record.
                if (record === (await session.exportSessionKey()))
                  throw new Error('Restored session was unexpectedly persisted')
                await new Promise<void>((resolve, reject) => {
                  const transaction = nativeRecords.transaction('keys', 'readwrite')
                  transaction.objectStore('keys').put(null, recordKey)
                  transaction.oncomplete = () => resolve()
                  transaction.onabort = () =>
                    reject(new Error('Synthetic corrupt record write failed'))
                })
                let rejected = false
                try {
                  await initCryptoSessionFromBrowser(undefined, false, {
                    namespace: 'synthetic-main',
                    nativeDevice: commands('main'),
                  })
                } catch (error) {
                  rejected =
                    error instanceof Error &&
                    error.message.includes('Stored wrapped session key is unusable')
                }
                if (!rejected)
                  throw new Error(
                    'Corrupt native session ciphertext silently regenerated a session',
                  )
              }
            } finally {
              nativeRecords.close()
            }
            const names = (await indexedDB.databases()).map((database) => database.name)
            if (
              names.includes('CryptoSession_synthetic-main') ||
              names.includes('CryptoSession_retired-agent')
            )
              throw new Error('Legacy desktop crypto was retained')
            const unrelated = await fixtureDatabase('synthetic-unrelated-settings')
            try {
              const sentinel = await new Promise<unknown>((resolve, reject) => {
                const request = unrelated
                  .transaction('keys', 'readonly')
                  .objectStore('keys')
                  .get('sentinel')
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(new Error('Unrelated fixture read failed'))
              })
              if (sentinel !== 'retained settings')
                throw new Error('Unrelated settings were deleted')
            } finally {
              unrelated.close()
            }
            const artifacts = await fixtureDatabase('synthetic-unrelated-artifacts')
            try {
              if (persist) {
                const dataKey = await crypto.subtle.generateKey(
                  { name: 'AES-GCM', length: 256 },
                  true,
                  ['encrypt', 'decrypt'],
                )
                const wrapped = await crypto.subtle.wrapKey(
                  'raw',
                  dataKey,
                  session.getSessionKey(),
                  'AES-KW',
                )
                const nonce = crypto.getRandomValues(new Uint8Array(12))
                const ciphertext = await crypto.subtle.encrypt(
                  { name: 'AES-GCM', iv: nonce },
                  dataKey,
                  new TextEncoder().encode('synthetic preserved data'),
                )
                await new Promise<void>((resolve, reject) => {
                  const transaction = artifacts.transaction('keys', 'readwrite')
                  transaction.objectStore('keys').put({ wrapped, nonce, ciphertext }, 'artifact')
                  transaction.oncomplete = () => resolve()
                  transaction.onabort = () => reject(new Error('Synthetic artifact write failed'))
                })
              } else {
                const artifact = await new Promise<{
                  wrapped: ArrayBuffer
                  nonce: Uint8Array<ArrayBuffer>
                  ciphertext: ArrayBuffer
                }>((resolve, reject) => {
                  const request = artifacts
                    .transaction('keys', 'readonly')
                    .objectStore('keys')
                    .get('artifact')
                  request.onsuccess = () => resolve(request.result)
                  request.onerror = () => reject(new Error('Synthetic artifact read failed'))
                })
                const dataKey = await crypto.subtle.unwrapKey(
                  'raw',
                  artifact.wrapped,
                  session.getSessionKey(),
                  'AES-KW',
                  'AES-GCM',
                  false,
                  ['decrypt'],
                )
                const plaintext = await crypto.subtle.decrypt(
                  { name: 'AES-GCM', iv: artifact.nonce },
                  dataKey,
                  artifact.ciphertext,
                )
                if (new TextDecoder().decode(plaintext) !== 'synthetic preserved data')
                  throw new Error('Old encrypted data did not survive restart')
              }
            } finally {
              artifacts.close()
            }
            await session.close()
            const channel = new MessageChannel()
            const stopHost = startNativeDeviceHost(channel.port1, commands('worker'))
            const workerSource = `import { initCryptoSessionFromBrowser, createNativeDeviceRequester } from '${moduleUrl}'; self.onmessage = async ({data}) => { const requester = createNativeDeviceRequester(data.port); try { const cs = await initCryptoSessionFromBrowser(undefined, data.persist, {namespace:'synthetic-worker', nativeDevice:requester.commands}); const id=await cs.getSessionId(); await cs.close(); self.postMessage({id}); } catch(error) {self.postMessage({error:String(error)})} finally {requester.stop()} };`
            const blobUrl = URL.createObjectURL(
              new Blob([workerSource], { type: 'text/javascript' }),
            )
            const worker = new Worker(blobUrl, { type: 'module' })
            try {
              const workerId = await new Promise<string>((resolve, reject) => {
                worker.onmessage = ({ data }) =>
                  data.error ? reject(new Error(data.error)) : resolve(data.id)
                worker.onerror = (event) => reject(new Error(event.message))
                worker.postMessage({ port: channel.port2, persist }, [channel.port2])
              })
              return { main, worker: workerId }
            } finally {
              worker.terminate()
              URL.revokeObjectURL(blobUrl)
              await stopHost()
            }
          },
          { persist },
        )
        results.push(result)
        await context.close()
        context = undefined
        await fixture.restart()
      }
      assert.deepEqual(results[0], results[1])
    } finally {
      await context?.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      fixture.stop()
      await rm(profile, { recursive: true, force: true })
    }
  })
}
