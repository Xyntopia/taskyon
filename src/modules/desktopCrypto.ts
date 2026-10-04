import {
  parseNativeDeviceOpen,
  parseNativeSessionEnvelope,
} from '@taskyon/runtime-browser/crypto-session'
import { invoke, isTauri } from '@tauri-apps/api/core'
import type {
  BrowserCryptoPersistence,
  NativeDeviceCommands,
} from '@taskyon/runtime-browser/crypto-session'

/** Host composition chooses custody once; session consumers use the same capability. */
export const desktopCryptoPersistence = (namespace = 'ty_device_key'): BrowserCryptoPersistence => {
  if (!isTauri()) return { namespace }
  const nativeDevice: NativeDeviceCommands = {
    open: (bindingPublicKey) =>
      invoke('device_open', { namespace, bindingPublicKey }).then(parseNativeDeviceOpen),
    openSession: (handle, transportPublicKey, wrappedSessionKey) =>
      invoke('device_open_session', { handle, transportPublicKey, wrappedSessionKey }).then(
        parseNativeSessionEnvelope,
      ),
    importSession: (handle, transportPublicKey, transportEnvelope) =>
      invoke('device_import_session', { handle, transportPublicKey, transportEnvelope }).then(
        parseNativeSessionEnvelope,
      ),
    close: (handle) => invoke('device_close', { handle }),
  }
  return { namespace, nativeDevice }
}
