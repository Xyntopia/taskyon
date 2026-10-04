import { startNativeCryptoFixture } from './nativeCryptoFixture'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createCryptoSession,
  generateAssymetricKeyDeriver,
  generateRandomEncryptionKey,
} from '@taskyon/taskyon/runtime-core'
import { createNativeCryptoSession, type NativeDeviceCommands } from '../nativeCryptoSession'
import { createNativeDeviceRequester, startNativeDeviceHost } from '../nativeCryptoBridge'

void test('Rust custody and WebCrypto restore, sharing, binding and worker capabilities agree', async () => {
  const fixture = startNativeCryptoFixture()
  const sessions: Awaited<ReturnType<typeof createNativeCryptoSession>>[] = []
  const { port1, port2 } = new MessageChannel()
  const hostStop = startNativeDeviceHost(port1, fixture.commands('synthetic-worker'))
  const worker = createNativeDeviceRequester(port2)
  try {
    const first = await createNativeCryptoSession(fixture.commands('synthetic-main'))
    sessions.push(first)
    assert.equal(first.getSessionKey().extractable, false)
    assert.equal('getDeviceKey' in first, false)
    await assert.rejects(crypto.subtle.exportKey('raw', first.getSessionKey()))
    const wrapped = await first.exportSessionKey()
    const identity = await first.deviceId()
    const sessionId = await first.getSessionId()
    await first.close?.()
    await fixture.restart()
    const restored = await createNativeCryptoSession(fixture.commands('synthetic-main'), {
      wrappedSK: wrapped,
    })
    sessions.push(restored)
    assert.equal(await restored.deviceId(), identity)
    assert.equal(await restored.getSessionId(), sessionId)
    const shareKey = await generateRandomEncryptionKey(true)
    const shared = await restored.exportSessionKey(shareKey)
    const imported = await createNativeCryptoSession(worker.commands, {
      wrappedSK: shared,
      unwrapper: shareKey,
    })
    sessions.push(imported)
    assert.equal(await imported.getSessionId(), sessionId)
    assert.notEqual(await imported.deviceId(), identity)
    const browser = await createCryptoSession({
      wrappedSK: await imported.exportSessionKey(shareKey),
      unwrapper: shareKey,
    })
    assert.equal(await browser.getSessionId(), sessionId)
    const binding = (await generateAssymetricKeyDeriver()).publicKey
    await assert.rejects(
      createNativeCryptoSession(fixture.commands('synthetic-main'), {
        wrappedSK: wrapped,
        bindingKey: binding,
      }),
    )
    await assert.rejects(
      worker.commands.openSession('unowned-handle', 'A'.repeat(43)),
      /Unauthorized/,
    )
    const regenerated = await restored.newSessionKey()
    sessions.push(regenerated)
    assert.equal(await regenerated.deviceId(), identity)
    assert.notEqual(await regenerated.getSessionId(), sessionId)
    await worker.commands.open().then((opened) => worker.commands.close(opened.handle))
  } finally {
    await Promise.all(sessions.map((session) => session.close?.()))
    worker.stop()
    await hostStop()
    fixture.stop()
  }
})

void test('stopping a worker capability rejects pending requests and closes late opens', async () => {
  const { port1, port2 } = new MessageChannel()
  let resolveOpen: ((value: Awaited<ReturnType<NativeDeviceCommands['open']>>) => void) | undefined
  let openedStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    openedStarted = resolve
  })
  const closed: string[] = []
  const handle = 'A'.repeat(43)
  const commands: NativeDeviceCommands = {
    open: () =>
      new Promise((resolve) => {
        resolveOpen = resolve
        openedStarted?.()
      }),
    openSession: () => Promise.reject(new Error('unexpected operation')),
    importSession: () => Promise.reject(new Error('unexpected operation')),
    close: (value) => {
      closed.push(value)
      return Promise.resolve()
    },
  }
  const hostStop = startNativeDeviceHost(port1, commands)
  const worker = createNativeDeviceRequester(port2)
  const pending = worker.commands.open()
  const rejection = assert.rejects(pending, /Closed/)
  await started
  worker.stop()
  await hostStop()
  resolveOpen?.({ handle, devicePublicKey: handle, wrapperId: handle })
  await rejection
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(closed, [handle])
})
