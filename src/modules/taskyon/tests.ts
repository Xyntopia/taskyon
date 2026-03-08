import type { KeyString, OpenAIMessage, partialTaskDraft, TaskNode } from '@taskyon/taskyon'
import {
  base64ToPublixX25519,
  chat2Md,
  convertTaskNodesToOpenAIChat,
  craeteToolJsonSchema,
  createCryptoSession,
  createDeepTransformer,
  createTaskNode,
  cryptoKeyToBase64,
  cryptoKeyToUint8,
  decompressEncryptedObject,
  deepCloneWJson,
  encryptCompressObject,
  generateAssymetricKeyDeriver,
  generateRandomEncryptionKey,
  generateSeedPhrase,
  getTextFile,
  jsonSchemaToYamlString,
  normalizeFalsyValues,
  OAUTH_PROVIDERS,
  removeKeys,
  safeYamlDump,
  sleep,
  summarizeTools,
  ToolBase,
  uint8ArrayToBase64UrlSafe,
  urlToFile,
  useNlpWorker,
  usePyodideWebworker,
  zodToYamlString,
} from '@taskyon/taskyon'
import { createChatCompletionTask, processTasks } from '@taskyon/client'
import { authenticateWithPopup } from '@taskyon/taskyon/browser'
import { getDatabase } from '@taskyon/taskyon/db'
import { until } from '@vueuse/core'
import type { JSONSchema7 } from 'json-schema'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import z from 'zod'
import { useGdrive } from '../gdrive'
import { getCurrentActiveProfileName, getStoredStateString } from '../ui/initialState'
import { initCryptoSessionFromBrowser } from './browserCryptoSession'
import { gDriveSyncPort } from './sync'

// Assuming hasMarkdownElements and containsHtmlTags are in scope
// import { hasMarkdownElements, containsHtmlTags } from './your-module'

const tystate = useTaskyonStore()
const state = useAppStateStore()

function assert(condition: boolean, msg?: string): asserts condition {
  if (!condition) {
    throw new Error(msg ?? 'Assertion failed')
  }
}

// Define types for the stored crypto key data
type StoredCryptoKeyPair =
  | CryptoKeyPair
  | {
      privateKey?: CryptoKey
      publicKey?: CryptoKey
      private?: CryptoKey
      public?: CryptoKey
    }

type TestReport = {
  success: boolean
  logs: string[]
  errors: string[]
  keyGeneration: {
    algorithm: string
    originalPrivateExtractable: boolean
    originalPublicExtractable: boolean
  }
  storage: {
    storeSuccess: boolean
    retrieveSuccess: boolean
  }
  postStorage: {
    privateKeyFound: boolean
    publicKeyFound: boolean
    privateExtractable: boolean | null
    publicExtractable: boolean | null
  }
  exportTests: {
    privateExportSuccess: boolean
    publicExportSuccess: boolean
    privateExportError?: string
    publicExportError?: string
  }
  securityValidation: {
    privateKeySecurityMaintained: boolean
    publicKeyAccessible: boolean
  }
}

export const testSessionSwitching = async () => {
  const logs: Record<string, unknown> = {}
  const keyPair = await generateAssymetricKeyDeriver()
  const pkey = keyPair.publicKey
  const publicBase64 = await cryptoKeyToBase64(pkey)

  const backconvert = await base64ToPublixX25519(publicBase64, true)
  const backextract = await cryptoKeyToBase64(backconvert)

  assert(publicBase64 === backextract)

  logs['session binding key storage (should all be the same)'] = {
    public_uint8: uint8ArrayToBase64UrlSafe(await cryptoKeyToUint8(pkey)),
    publicBase64,
    backextract,
  }

  const firstSessionId = state.sessionId
  logs['first session id'] = firstSessionId

  await until(() => state.initWBindingKey).changed({ timeout: 5000 })
  //assert(firstSessionId !== state.sessionId, 'session id should have changed!')
  logs['new session id'] = state.sessionId

  return logs
}

export const testIndexedDBKeyStorage = async (): Promise<TestReport> => {
  const DB = 'test_crypto_key_roundtrip'
  const STORE = 'keys'
  const KEY_NAME = 'deviceKeyPair'

  const report: TestReport = {
    success: false,
    logs: [],
    errors: [],
    keyGeneration: {
      algorithm: '',
      originalPrivateExtractable: false,
      originalPublicExtractable: false,
    },
    storage: {
      storeSuccess: false,
      retrieveSuccess: false,
    },
    postStorage: {
      privateKeyFound: false,
      publicKeyFound: false,
      privateExtractable: null,
      publicExtractable: null,
    },
    exportTests: {
      privateExportSuccess: false,
      publicExportSuccess: false,
    },
    securityValidation: {
      privateKeySecurityMaintained: false,
      publicKeyAccessible: false,
    },
  }

  function log(message: string) {
    report.logs.push(message)
  }

  function error(message: string) {
    report.errors.push(message)
  }

  // helpers
  function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(new Error(req.error?.message || 'DB open failed'))
    })
  }

  async function putValue(val: CryptoKeyPair): Promise<boolean> {
    const db = await openDB()
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const r = store.put(val, KEY_NAME)
        r.onsuccess = () => resolve(true)
        r.onerror = () => reject(new Error(r.error?.message || 'put failed'))
        tx.onabort = () => reject(new Error(tx.error?.message || 'tx aborted'))
        tx.oncomplete = () => {
          /* ok */
        }
      })
    } finally {
      db.close()
    }
  }

  async function getValue(): Promise<StoredCryptoKeyPair> {
    const db = await openDB()
    try {
      return await new Promise<StoredCryptoKeyPair>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const store = tx.objectStore(STORE)
        const r = store.get(KEY_NAME)
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(new Error(r.error?.message || 'get failed'))
        tx.onabort = () => reject(new Error(tx.error?.message || 'tx aborted'))
      })
    } finally {
      db.close()
    }
  }

  // Generate crypto key pair (with non-extractable private key for security test)
  let kp: CryptoKeyPair

  try {
    // try X25519 (modern) - private key should be non-extractable
    kp = (await crypto.subtle.generateKey({ name: 'X25519' }, false, [
      'deriveKey',
      'deriveBits',
    ])) as CryptoKeyPair
    report.keyGeneration.algorithm = 'X25519'
    log('generated X25519 pair')
  } catch {
    kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
      'deriveKey',
      'deriveBits',
    ])
    report.keyGeneration.algorithm = 'ECDH P-256'
    log('fallback to ECDH P-256 pair')
  }

  // Record original extractable properties
  report.keyGeneration.originalPrivateExtractable = kp.privateKey.extractable
  report.keyGeneration.originalPublicExtractable = kp.publicKey.extractable

  log(`original private.extractable: ${kp.privateKey.extractable}`)
  log(`original public.extractable: ${kp.publicKey.extractable}`)

  // Security check: Verify the private key is non-extractable
  if (kp.privateKey.extractable) {
    const errorMsg = 'SECURITY VIOLATION: Private key should be non-extractable for this test!'
    error(errorMsg)
    throw new Error(errorMsg)
  }

  // Security check: Verify the public key IS extractable (public keys should always be extractable)
  if (!kp.publicKey.extractable) {
    const errorMsg = 'SECURITY VIOLATION: Public key should be extractable!'
    error(errorMsg)
    throw new Error(errorMsg)
  }

  // store pair
  const storeSuccess = await putValue(kp)
  report.storage.storeSuccess = storeSuccess
  log('Successfully stored key pair in IndexedDB')

  // retrieve
  const loaded = await getValue()
  report.storage.retrieveSuccess = true
  log('Successfully retrieved key pair from IndexedDB')

  // Type guard to check if object has alternative key properties
  function hasAlternativeKeys(obj: unknown): obj is { private?: CryptoKey; public?: CryptoKey } {
    return typeof obj === 'object' && obj !== null && ('private' in obj || 'public' in obj)
  }

  // the loaded object may be a CryptoKeyPair or an object with keys; attempt to detect
  const privateLoaded =
    loaded?.privateKey ?? (hasAlternativeKeys(loaded) ? loaded.private : undefined)
  const publicLoaded = loaded?.publicKey ?? (hasAlternativeKeys(loaded) ? loaded.public : undefined)

  // Check if keys were found
  report.postStorage.privateKeyFound = !!privateLoaded
  report.postStorage.publicKeyFound = !!publicLoaded

  if (!privateLoaded) {
    const errorMsg = 'CRITICAL: Private key not found after retrieval from IndexedDB'
    error(errorMsg)
    throw new Error(errorMsg)
  }

  if (!publicLoaded) {
    const errorMsg = 'CRITICAL: Public key not found after retrieval from IndexedDB'
    error(errorMsg)
    throw new Error(errorMsg)
  }

  // Check extractable properties post-storage
  report.postStorage.privateExtractable = privateLoaded.extractable
  report.postStorage.publicExtractable = publicLoaded.extractable

  log(`loaded.privateKey?.extractable = ${privateLoaded.extractable}`)
  log(`loaded.publicKey?.extractable  = ${publicLoaded.extractable}`)

  // CRITICAL SECURITY CHECK: Private key must remain non-extractable
  if (privateLoaded.extractable) {
    const errorMsg = 'SECURITY VIOLATION: Private key became extractable after storage/retrieval!'
    error(errorMsg)
    throw new Error(errorMsg)
  }

  // CRITICAL SECURITY CHECK: Public key should remain extractable
  if (!publicLoaded.extractable) {
    const errorMsg =
      'SECURITY VIOLATION: Public key became non-extractable after storage/retrieval!'
    error(errorMsg)
    throw new Error(errorMsg)
  }

  // try to export both keys (export should fail for non-extractable private)
  async function tryExport(key: CryptoKey | undefined, label: string): Promise<boolean> {
    if (!key) {
      log(`${label} key missing`)
      return false
    }
    try {
      const jwk = await crypto.subtle.exportKey('jwk', key)
      log(`${label} export OK — jwk keys: ${Object.keys(jwk).join(', ')}`)

      // SECURITY CHECK: If this was originally a non-extractable private key, this is a problem!
      if (label === 'private' && !kp.privateKey.extractable) {
        const errorMsg =
          'SECURITY VIOLATION: Successfully extracted a non-extractable private key from IndexedDB!'
        error(errorMsg)
        throw new Error(errorMsg)
      }

      return true
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      log(`${label} export FAILED (expected for non-extractable): ${errorMessage}`)

      // This is the expected behavior for non-extractable keys
      if (label === 'private' && !kp.privateKey.extractable) {
        log('✅ Security test PASSED: Non-extractable private key remained non-extractable')
      }

      // Store error details
      if (label === 'private') {
        report.exportTests.privateExportError = errorMessage
      } else {
        report.exportTests.publicExportError = errorMessage
      }

      return false
    }
  }

  report.exportTests.privateExportSuccess = await tryExport(privateLoaded, 'private')
  report.exportTests.publicExportSuccess = await tryExport(publicLoaded, 'public')

  // Final security validation
  report.securityValidation.privateKeySecurityMaintained = !report.exportTests.privateExportSuccess
  report.securityValidation.publicKeyAccessible = report.exportTests.publicExportSuccess

  // If private key export succeeded, that's a security violation
  if (report.exportTests.privateExportSuccess) {
    const errorMsg = 'SECURITY VIOLATION: Private key export should have failed!'
    error(errorMsg)
    throw new Error(errorMsg)
  }

  // If public key export failed, that's also a problem
  if (!report.exportTests.publicExportSuccess) {
    const errorMsg = 'SECURITY VIOLATION: Public key export should have succeeded!'
    error(errorMsg)
    throw new Error(errorMsg)
  }

  log('✅ All security tests PASSED')
  report.success = true

  // cleanup
  try {
    await new Promise<void>((res, rej) => {
      const req = indexedDB.deleteDatabase(DB)
      req.onsuccess = () => res()
      req.onerror = () => rej(new Error(req.error?.message || 'delete failed'))
      req.onblocked = () => rej(new Error('delete blocked'))
    })
    log('Database cleanup completed')
  } catch (e) {
    const errorMsg = `Database cleanup failed: ${e instanceof Error ? e.message : String(e)}`
    error(errorMsg)
    // Don't throw cleanup errors - just log them
  }

  return report
}
// TODO: encrypt a file with device1 SK and decrypt with device2 SK
//       both SK should work, but they look different as wrapped with different DKs
export async function testCryptoSession() {
  const report: string[] = []

  const testMnemonic = generateSeedPhrase()

  // Clean up any existing databases first
  // await forceDestroyCryptoSession()

  // ===================================================================
  // Phase 1: Single Device Setup and Key Management
  // ===================================================================
  report.push('PHASE 1: Single device initialization and key management')

  // Create primary device session
  const device1 = await initCryptoSessionFromBrowser({ mnemonic: testMnemonic })
  report.push('Device1 session ceate')

  // Validate initial keys
  const sessionKey1 = device1.getSessionKey()
  const devicePubKey1 = device1.getDevicePublicKey()
  report.push(`Device1 public key: ${JSON.stringify(devicePubKey1)}`)

  // Test session key regeneration
  const device1_1 = await device1.newSessionKey()
  const newSessionKey = device1_1.getSessionKey()
  report.push('Session key regenerated')

  assert(
    (await device1_1.deviceId()) === (await device1.deviceId()),
    "device ids shouldn't haven't changed and should be the same!",
  )

  assert(
    (await device1_1.getSessionId()) !== (await device1.getSessionId()),
    'session ids should change!',
  )

  // Test device key regeneration
  const originalDeviceKey = device1.getDevicePublicKey()
  const device1_2 = await device1_1.newDeviceKey()
  const newDeviceKey = device1_2.getDevicePublicKey()

  // Verify device key changed
  const origKeyBytes = uint8ArrayToBase64UrlSafe(
    await crypto.subtle.exportKey('raw', originalDeviceKey),
  )
  const newKeyBytes = uint8ArrayToBase64UrlSafe(await crypto.subtle.exportKey('raw', newDeviceKey))
  if (origKeyBytes === newKeyBytes) {
    report.push('ERROR: Device key not regenerated')
  } else {
    report.push('Device key successfully regenerated')
  }

  // Test user key management
  const userPubKey = (await device1.derive({ mnemonic: generateSeedPhrase() })).getUserPublicKey()
  report.push(`User public key: ${await cryptoKeyToBase64(userPubKey.publicKey)}`)

  // ===================================================================
  // Phase 2: Key Sharing Between Devices
  // ===================================================================
  report.push('\nPHASE 2: Key sharing between devices')

  // Create exchange keys (simulate second device's key pair)
  const exchangeKey = await generateRandomEncryptionKey(true)
  report.push('Exchange key pair generated')

  // Export wrapped session key from device1
  const d1SKid = await device1.getSessionId()
  const wrappedSessionKey = await device1.exportSessionKey(exchangeKey)
  report.push('Session key wrapped for sharing')

  // Create second device session
  const device2 = await createCryptoSession({
    wrappedSK: wrappedSessionKey,
    unwrapper: exchangeKey,
  })
  report.push('Device2 session created')
  report.push('Wrapped session key imported to device2')

  // Validate session keys
  const d2SKid = await device2.getSessionId()
  report.push('Device2 successfully accessed session key')

  // ===================================================================
  // Phase 3: Session Destruction and Cleanup
  // ===================================================================
  report.push('\nPHASE 3: Session destruction and cleanup')

  // TODO: we can not do this right now, because it would alter the currently active session
  // id. So we are commenting this out for now...
  //await deleteSession(device1)

  // Verify new session can be created after destruction
  const newSession = await createCryptoSession()
  newSession.getSessionKey()
  report.push('New session created after destruction')

  assert(
    (await newSession.getSessionId()) !== (await device1.getSessionId()),
    'Sessions should be different now!!',
  )

  return {
    logs: report,
    testMnemonic,
    sessionKey1,
    newSessionKey,
    device1_session_id: d1SKid,
    device2_session_id: d2SKid,
    origKeyBytes,
    newKeyBytes,
    wrappedSessionKey,
    id1: await device1.deviceId(),
    id1_1: await device1_1.deviceId(),
    id1_2: await device1_2.deviceId(),
    id2: await device2.deviceId(),
    SKAfterSKdelete: await newSession.getSessionId(),
    metrics: {
      deviceKeyRegenerated: origKeyBytes !== newKeyBytes,
      sessionKeyShared: !!wrappedSessionKey,
      sessionDestroyed: true,
    },
  }
}

// Enhanced integration test for concurrent uploads
export async function testMultipleArchiveUploadDownload() {
  const results: Record<string, unknown> = {}

  type DriveFile = {
    id: string
    name: string
    parents?: string[]
  }

  type DirectoryCheck = {
    directoryId: string
    filesFound: number
    expectedFiles: number
    filesInDirectory: { id: string; name: string }[]
    allFilesInSameDirectory: boolean
    allUploadedFilesFound: boolean
  }

  // Create unique directory name with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = `taskyon/tests/random_dir${timestamp}`

  // Create multiple "archive" files with different logical filenames
  const archives = [
    {
      logicalFilenames: ['foo.txt', 'bar.json'],
      content: 'Archive 1 content',
      filename: `archive1-${timestamp}.zip`,
    },
    {
      logicalFilenames: ['baz.md', 'qux.xml'],
      content: 'Archive 2 content',
      filename: `archive2-${timestamp}.zip`,
    },
    {
      logicalFilenames: ['test.js', 'config.yaml'],
      content: 'Archive 3 content',
      filename: `archive3-${timestamp}.zip`,
    },
  ]

  // Create File objects
  const zipFiles = archives.map(
    (archive) => new File([archive.content], archive.filename, { type: 'application/zip' }),
  )

  console.log(`Uploading ${archives.length} archives concurrently to directory: ${dir}`)
  console.log(
    'Logical filenames per archive:',
    archives.map((a) => a.logicalFilenames),
  )

  // Upload all archives concurrently - this is where the race condition might occur
  const uploadPromises = archives.map((archive, index) => {
    const zipFile = zipFiles[index]
    if (!zipFile) throw new Error(`Missing zip file for archive ${index}`)
    return useGdrive(tystate.getGdriveToken)
      .uploadFileArchiveWMeta(
        dir,
        zipFile,
        archive.logicalFilenames,
        true, // share publicly
      )
      .then((result) => ({
        index,
        result,
        logicalFilenames: archive.logicalFilenames,
      }))
  })

  const uploadResults = await Promise.all(uploadPromises)
  results.uploadResults = uploadResults.map((ur) => ({
    index: ur.index,
    fileId: ur.result.id,
    fileName: ur.result.name,
    webViewLink: ur.result.webViewLink,
  }))
  console.log('All uploads completed successfully')

  // Now let's check if all files are in the same directory
  console.log('Checking if all files landed in the same directory...')

  // Get access token by calling the oauth provider directly
  const creds = await tystate.getToken('google', {
    oauthURL: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientId: 'your-client-id', // You'll need to import OAUTH_PROVIDERS.google.clientId
    scope: 'https://www.googleapis.com/auth/drive.file',
  })
  const token = creds.access_token

  // Use the resolveId helper from gdrive module instead of the cached version
  const gdrive = useGdrive(tystate.getGdriveToken)

  // Since we can't access resolveDriveId directly, let's verify by listing files in the directory
  // First, try to load a file to verify the directory exists and get its ID implicitly
  try {
    // Try to resolve the directory by attempting to find any file we just uploaded
    const firstUploadedFile = uploadResults[0]
    if (!firstUploadedFile) throw new Error('No files were uploaded')

    // Get file metadata to check its parent directory
    const fileMetaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${firstUploadedFile.result.id}?fields=parents`,
      { headers: { Authorization: `Bearer ${token}` } },
    )

    if (!fileMetaRes.ok) {
      throw new Error(
        `Failed to get file metadata for directory check: ${await fileMetaRes.text()}`,
      )
    }

    const fileMeta = await fileMetaRes.json()
    const parentId = fileMeta.parents?.[0]
    if (!parentId) {
      throw new Error('Uploaded file has no parent directory')
    }

    // List all files in this parent directory
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${parentId}' in parents and trashed=false&fields=files(id,name,parents)`,
      { headers: { Authorization: `Bearer ${token}` } },
    )

    if (!listRes.ok) {
      throw new Error(`Failed to list files in directory: ${await listRes.text()}`)
    }

    const listData = await listRes.json()
    const filesInDirectory = (listData.files as DriveFile[]) || []

    const directoryCheck: DirectoryCheck = {
      directoryId: parentId,
      filesFound: filesInDirectory.length,
      expectedFiles: archives.length,
      filesInDirectory: filesInDirectory.map((f: DriveFile) => ({ id: f.id, name: f.name })),
      allFilesInSameDirectory: filesInDirectory.length === archives.length,
      allUploadedFilesFound: false,
    }

    // Check if all uploaded files are in this directory
    const uploadedFileIds = uploadResults.map((ur) => ur.result.id)
    const foundFileIds = filesInDirectory.map((f: DriveFile) => f.id)
    const allFilesFound = uploadedFileIds.every((id) => foundFileIds.includes(id))

    directoryCheck.allUploadedFilesFound = allFilesFound
    results.directoryCheck = directoryCheck

    if (!allFilesFound) {
      const missingFiles = uploadedFileIds.filter((id) => !foundFileIds.includes(id))
      throw new Error(
        `Race condition detected: Not all uploaded files found in target directory. Missing file IDs: ${missingFiles.join(', ')}`,
      )
    }

    console.log(
      `Directory check: Found ${filesInDirectory.length} files, expected ${archives.length}`,
    )
    console.log('All uploaded files found in directory:', allFilesFound)
  } catch (error) {
    throw new Error(
      `Directory verification failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // Test downloading by logical filename
  console.log('Testing download by logical filename...')
  const downloadTests = []

  for (const archive of archives) {
    for (const logicalFilename of archive.logicalFilenames) {
      console.log(`Trying to download archive by logical filename "${logicalFilename}"`)
      const downloaded = await gdrive.downloadArchiveFile(dir, logicalFilename)

      if (!downloaded) {
        throw new Error(
          `Failed to download archive by logical filename "${logicalFilename}" from directory "${dir}"`,
        )
      }

      const text = await downloaded.text()
      downloadTests.push({
        logicalFilename,
        success: true,
        fileName: downloaded.name,
        type: downloaded.type,
        size: downloaded.size,
        contentPreview: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      })
    }
  }

  results.downloadTests = downloadTests

  const directoryCheck = results.directoryCheck as DirectoryCheck
  console.log('Test completed', {
    uploadsSuccessful: uploadResults.length,
    directoryIssues: !directoryCheck.allUploadedFilesFound,
    downloadTestsRun: downloadTests.length,
  })

  return results
}
testMultipleArchiveUploadDownload.gui = true

// quick-n-dirty integration test
export async function testArchiveUploadDownload() {
  const results: Record<string, unknown> = {}

  const dir = 'taskyon/test-archive-dir'
  const logicalFilenames = ['foo.txt', 'bar.json']
  const uploadedContent = 'Hello from archive!'

  // create a zip archive? nah: keep it simple → just one text file
  const fakeZipFile = new File([uploadedContent], `archive${new Date().toISOString()}.zip`, {
    type: 'application/zip',
  })

  console.log('Uploading archive with meta for:', logicalFilenames)
  const uploaded = await useGdrive(tystate.getGdriveToken).uploadFileArchiveWMeta(
    dir,
    fakeZipFile,
    logicalFilenames,
    true,
  )
  results.uploaded = uploaded

  // now retrieve by meta name (search for foo.txt inside archive props)
  console.log('Trying to download archive by logical filename "foo.txt"')
  const downloaded = await useGdrive(tystate.getGdriveToken).downloadArchiveFile(dir, 'foo.txt')
  results.downloaded = {
    ok: !!downloaded,
    name: downloaded?.name,
    type: downloaded?.type,
    size: downloaded?.size,
    text: downloaded ? await downloaded.text() : null,
  }

  console.log('Test completed', results)
  return results
}
testArchiveUploadDownload.gui = true

export const testPyodide = async () => {
  const python = usePyodideWebworker()

  const sampleText =
    'Taskyon is an open-source platform for managing tasks, projects, and workflows efficiently.'
  const kws = await python.extractKeywords(sampleText, 5)

  return {
    kws,
  }
}

async function createTestKeys() {
  const recoveryKey = (
    await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    )
  ).publicKey

  // Generate a symmetric key (AES-GCM)
  const sessionKey = await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  )
  return { recoveryKey, sessionKey }
}

export async function oauthTests() {
  const creds = await authenticateWithPopup(
    {
      oauthURL: OAUTH_PROVIDERS.google.authUrl,
      clientId: OAUTH_PROVIDERS.google.clientId,
      scope: OAUTH_PROVIDERS.google.scope,
    },
    undefined,
  )

  return creds
}
oauthTests.gui = true

export async function testGdriveZipRoundtrip() {
  const t0 = Date.now()
  const logs: string[] = []
  const steps: Array<{ step: string; ok: boolean; detail?: unknown }> = []

  function log(step: string, detail?: unknown, ok = true) {
    const msg = `[${new Date().toISOString()}] ${step}${detail ? `: ${JSON.stringify(detail)}` : ''}`
    console.log(msg)
    logs.push(msg)
    steps.push({ step, ok, detail })
  }

  try {
    // 2) pick a fresh directory so tests don’t clash
    const directory = `taskyon/taskyon-tests/${new Date().toISOString().replace(/[:.]/g, '-')}`
    log('target directory chosen', directory)

    const gdport = gDriveSyncPort(directory, tystate.getGdriveToken, (error) => {
      throw error
    })

    const objs: Record<string, unknown> = {
      'a1f2c3d4e5.txt': 'hello A',
      'b6c7d8e9f0.json': { k: 1 },
      'deadbeefcaf0.md': ['# hi'],
    }
    log('prepared test data', objs)

    const filenames = Object.keys(objs)
    const archiveName = 'roundtrip.tyt'

    const { recoveryKey, sessionKey } = await createTestKeys()
    log('created keys', { recoveryKey, sessionKey })

    // compress objects "locally" (for the test)
    const packed = await encryptCompressObject(
      objs,
      archiveName,
      () => recoveryKey,
      () => sessionKey,
    )
    log('created encrypted msgpack file...')

    // we want to allow additional data to be send, for "upwards" compatibility
    // e.g. in the future we might want to add public keys and other things. Maybe we want to
    // encrypt tasks with synchronized session keys and similar things...
    gdport.send({
      type: 'addTasks',
      data: packed,
      info: archiveName,
      ids: filenames,
      additionalDataTest: 'hello!   we are simply testing additional keys',
    })
    // and send them of to gdrive...
    log('sent data to gdrive', { archiveName, filenames })

    // 4) for each filename, locate its zip via properties and download it
    const fileChecks: Array<{
      filename: string
      found: boolean
      blobSize?: number
      blobType?: string
      error?: string
    }> = []

    await new Promise((resolve) => {
      const unsub = gdport.receive((msg) => {
        if (msg.type === 'taskCreated') {
          log('received taskCreated message', msg)
          resolve(true)
          unsub()
        }
      })
    })

    for (const name of filenames) {
      try {
        gdport.send({ type: 'requestTask', id: name })
        await new Promise<boolean>((resolve) => {
          const unsub = gdport.receive(async (msg) => {
            if (msg.type === 'addTasks') {
              const decompressed = await decompressEncryptedObject(
                msg.data,
                msg.info,
                () => sessionKey,
              )
              const data = decompressed[name]
              log('decompressed and decrypted file', { name, decompressed })
              const info = {
                filename: name,
                found: true,
                blobSize: msg.data.length,
                ids: msg.ids,
                originalData: objs[name],
                data: data,
              }
              fileChecks.push(info)
              log(`download hit for ${name}`, info)

              resolve(true)
              unsub()
            } else if (msg.type === 'taskCreated') {
              log('received taskCreated message', msg)
              resolve(true)
            } else {
              fileChecks.push({ filename: name, found: false })
              log(`download miss for ${name}`, undefined, /*ok*/ false)
            }
          })
        })
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e)
        fileChecks.push({ filename: name, found: false, error: err })
        log(`download error for ${name}`, err, /*ok*/ false)
      }
    }

    const allFound = fileChecks.every((fc) => fc.found)
    return {
      ok: allFound,
      directory,
      fileChecks,
      steps,
      logs,
      durationMs: Date.now() - t0,
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? { message: e.message, stack: e.stack } : { message: String(e) }
    log('fatal error', err, /*ok*/ false)
    return {
      ok: false,
      error: err,
      steps,
      logs,
      durationMs: Date.now() - t0,
    }
  }
}
testGdriveZipRoundtrip.gui = true

export const testSecretStore = async () => {
  console.log('request a random secret from the store')

  const ty = await tystate.taskyon

  const secretName = 'MYTESTTOKEN'
  await ty.deleteSecret('diagnostics', secretName)
  const MYTESTTOKEN = await ty.getSecret('diagnostics', secretName, true)

  // Generate a random string as the test secret
  const test_secret = Math.random().toString(36).slice(2) + Date.now().toString()
  await ty.setSecret('diagnostics', secretName, test_secret)
  const returned_secret = await ty.getSecret('diagnostics', secretName, true)

  await ty.deleteSecret('diagnostics', 'unknown_secret')
  const undefinedSecret = await ty.getSecret('diagnostics', 'unknown_secret', true)

  return {
    MYTESTTOKEN,
    returned_secret,
    test_secret,
    undefinedSecret,
  }
}

export async function testToolList() {
  console.log('gather all available tools in a list!')

  const ty = await tystate.taskyon

  const allTools = (await ty.updateToolDefinitions()) ?? []
  return {
    'all tools': summarizeTools(Object.keys(allTools), allTools),
  }
}

export function testJsonSchemas() {
  console.log('create test schemas!')

  return {
    toolBaseJsonSchema: craeteToolJsonSchema(),
    toolJsonSchema: z.toJSONSchema(ToolBase, { unrepresentable: 'any' }),
    yamlString: zodToYamlString(ToolBase),
  }
}

export async function testGdriveUpload() {
  const { publishMarkdown } = useGdrive(tystate.getGdriveToken)

  const markdownContent =
    '# Sample Markdown\n\nThis is a sample markdown file generated by Taskyon to test Gdrive functionality.\n\n' +
    new Date().toISOString()

  const gdriveFile = await publishMarkdown(
    markdownContent,
    state.appConfiguration.gdriveDir,
    'taskyon_test.md',
    true,
  )

  return gdriveFile

  //throw { message: 'could not found the task we just loaded!!' };
}
testGdriveUpload.gui = true

export function testCreateDeepTansformer() {
  const errors: unknown[] = []
  function assert(cond: unknown, msg: string) {
    if (!cond) errors.push(msg)
  }

  // Test 1: key-normalization
  const robustKeys = createDeepTransformer({
    keyFn: (k) =>
      String(k)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
  })
  const input1 = {
    'Foo-Bar': 1,
    Nested_Key: { 'Inner Map': 2 },
    arr: [{ 'X-Y': 3 }],
  }
  const expected1 = {
    foobar: 1,
    nestedkey: { innermap: 2 },
    arr: [{ xy: 3 }],
  }
  const output1 = robustKeys(input1)
  assert(
    JSON.stringify(output1) === JSON.stringify(expected1),
    `robustKeys failed:\n  expected ${JSON.stringify(expected1)}\n  got      ${JSON.stringify(output1)}`,
  )

  // Test 2: falsy-value normalization
  const normalize = normalizeFalsyValues()
  const input2 = {
    a: 'no',
    b: 'yes',
    c: 0,
    d: 'OK',
    nested: ['n/a', 'Y'],
  }
  const expected2 = {
    a: false,
    b: 'yes',
    c: false,
    d: 'OK',
    nested: [false, 'Y'],
  }
  const output2 = normalize(input2)
  assert(
    JSON.stringify(output2) === JSON.stringify(expected2),
    `normalizeFalsyValues failed:\n  expected ${JSON.stringify(expected2)}\n  got      ${JSON.stringify(output2)}`,
  )

  return {
    success: errors.length === 0,
    errors,
  }
}

export const testChatCompletionWebSearch = async () => {
  console.log('do a websearch using chatCompletion')

  const taskList: partialTaskDraft[][] = [
    [
      {
        role: 'user',
        content: { type: 'message', data: 'hi!..   can you please search for for "taskyon" is?' },
      },
      createChatCompletionTask({
        goal: 'WebSearch',
        model: 'google/gemini-2.5-flash-lite',
        llmTools: true,
        max_results: 2,
      }),
    ],
  ]

  const result = await processTasks(tystate.api)(taskList, 'message', { timeoutMs: 20000 })

  const webSearchResponse = result.content.data

  return {
    taskList,
    result,
    webSearchResponse,
  }
}
testChatCompletionWebSearch.description = 'test taskyon chatCompletion websearch'

export const testChatCompletion = async () => {
  const ty = await tystate.taskyon

  const stopSignal = new AbortController().signal

  // Invoke the real tool
  const { tool: chatCompletion } = await ty.getToolDefinition('chatCompletion')
  let structuredResponse
  if (chatCompletion && 'function' in chatCompletion && chatCompletion.function !== undefined) {
    const prompt_templates = state.toolchainConfig.chatCompletion?.prompt_templates
    structuredResponse = await chatCompletion.function(
      {
        model: 'google/gemini-2.5-flash-lite',
        prompts: [
          `Please respond with a JSON object matching the provided schema. This is meant as an example!  So you can simply come up with a random user and preferences.`,
        ],
        llmTools: true,
        prompt_templates,
        schema: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              description: new Date().toISOString(),
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
              additionalProperties: false,
              required: ['id', 'name'],
            },
            preferences: {
              type: 'object',
              properties: {
                theme: { type: 'string', enum: ['light', 'dark'] },
              },
              additionalProperties: false,
              required: ['theme'],
            },
          },
          additionalProperties: false,
          required: ['user', 'preferences'],
        },
      },
      {
        taskChain: [],
        getSecret: (name) => tystate.getProviderApiKey(name),
        setSecret: () => {
          console.log('set test secret')
          return Promise.resolve()
        },
        stopSignal,
        toolId: 'N/A',
      },
    )
  }

  return {
    structuredResponse,
  }
}

export const testChatCompletionTaskyonProxyMint = async () => {
  const prevSelectedApi = state.llmSettings.selectedApi
  state.setLLMSettings('selectedApi', 'taskyon')

  const streamStats = new Map<
    string,
    {
      textDeltaCount: number
      rawChunkCount: number
      semanticChunkCount: number
      reasoningDeltaCount: number
      toolInputDeltaCount: number
      totalTextChars: number
    }
  >()
  const stopStreamProbe = tystate.chatCompletionStream(({ taskId, chunk }) => {
    if (!chunk) return
    const stats = streamStats.get(taskId) ?? {
      textDeltaCount: 0,
      rawChunkCount: 0,
      semanticChunkCount: 0,
      reasoningDeltaCount: 0,
      toolInputDeltaCount: 0,
      totalTextChars: 0,
    }
    switch (chunk.type) {
      case 'text-delta':
        stats.textDeltaCount++
        stats.semanticChunkCount++
        stats.totalTextChars += chunk.text.length
        break
      case 'raw':
        stats.rawChunkCount++
        break
      case 'reasoning-delta':
        stats.semanticChunkCount++
        stats.reasoningDeltaCount++
        break
      case 'tool-input-delta':
        stats.semanticChunkCount++
        stats.toolInputDeltaCount++
        break
      default:
        break
    }
    streamStats.set(taskId, stats)
  })

  try {
    const taskList: partialTaskDraft[][] = [
      [
        {
          role: 'user',
          content: {
            type: 'message',
            data: 'Write a plain-text status report with exactly 18 short lines explaining that delegated proxy backend streaming is active. Do not use markdown.',
          },
        },
        createChatCompletionTask({
          goal: 'SimpleCompletion',
          model: 'google/gemini-2.5-flash-lite',
          llmTools: false,
        }),
      ],
    ]

    const result = await processTasks(tystate.api)(taskList, ['message', 'return'], {
      timeoutMs: 20000,
    })
    assert(
      result.content.type === 'message',
      `Delegated proxy run returned non-message task content: ${result.content.type}`,
    )
    const streamedTasks = [...streamStats.entries()].filter(([, stats]) => stats.textDeltaCount > 0)
    assert(streamedTasks.length > 0, 'No text-delta chunks were observed for delegated proxy run')
    const [streamedTaskId, bestStats] = streamedTasks.sort(
      (a, b) => b[1].textDeltaCount - a[1].textDeltaCount,
    )[0]!
    assert(
      bestStats.textDeltaCount >= 2,
      `Expected streaming with >=2 text chunks, got ${bestStats.textDeltaCount}`,
    )
    assert(
      bestStats.totalTextChars > 20,
      `Expected streamed output length > 20 chars, got ${bestStats.totalTextChars}`,
    )
    assert(
      bestStats.semanticChunkCount >= 2,
      `Expected at least 2 semantic streamed chunks, got ${bestStats.semanticChunkCount}`,
    )

    return {
      taskList,
      result,
      streaming: {
        streamedTaskId,
        ...bestStats,
        allStreamedTasks: Object.fromEntries(streamedTasks),
      },
    }
  } finally {
    stopStreamProbe()
    state.setLLMSettings('selectedApi', prevSelectedApi || 'taskyon')
  }
}
testChatCompletionTaskyonProxyMint.description =
  'test chatCompletion via delegated taskyon SSR proxy backend'

export const testChatCompletionTaskyonProxyMintSupabaseCosts = async () => {
  const ty = await tystate.taskyon
  const prevSelectedApi = state.llmSettings.selectedApi
  const prevTaskyonKey = tystate.getTaskyonKeyString()
  const userAuthToken = state.authToken
  if (!(typeof userAuthToken === 'string' && userAuthToken.length > 0)) {
    return {
      skipped: true,
      warning:
        'Skipped: this test requires a logged-in user with a valid taskyon auth token and credits.',
    }
  }
  await tystate.setProviderApiKey('taskyon', userAuthToken)
  state.setLLMSettings('selectedApi', 'taskyon')

  const streamStats = new Map<
    string,
    {
      textDeltaCount: number
      rawChunkCount: number
      semanticChunkCount: number
      reasoningDeltaCount: number
      toolInputDeltaCount: number
      totalTextChars: number
    }
  >()

  const stopStreamProbe = tystate.chatCompletionStream(({ taskId, chunk }) => {
    if (!chunk) return
    const stats = streamStats.get(taskId) ?? {
      textDeltaCount: 0,
      rawChunkCount: 0,
      semanticChunkCount: 0,
      reasoningDeltaCount: 0,
      toolInputDeltaCount: 0,
      totalTextChars: 0,
    }
    switch (chunk.type) {
      case 'text-delta':
        stats.textDeltaCount++
        stats.semanticChunkCount++
        stats.totalTextChars += chunk.text.length
        break
      case 'raw':
        stats.rawChunkCount++
        break
      case 'reasoning-delta':
        stats.semanticChunkCount++
        stats.reasoningDeltaCount++
        break
      case 'tool-input-delta':
        stats.semanticChunkCount++
        stats.toolInputDeltaCount++
        break
      default:
        break
    }
    streamStats.set(taskId, stats)
  })

  try {
    const taskList: partialTaskDraft[][] = [
      [
        {
          role: 'user',
          content: {
            type: 'message',
            data: 'Write a plain-text status report with exactly 18 short lines explaining that delegated proxy backend streaming is active. Do not use markdown.',
          },
        },
        createChatCompletionTask({
          goal: 'SimpleCompletion',
          model: 'google/gemini-2.5-flash-lite',
          llmTools: false,
        }),
      ],
    ]

    const result = await processTasks(tystate.api)(taskList, ['message', 'return'], {
      timeoutMs: 20000,
    })
    assert(
      result.content.type === 'message',
      `Delegated proxy supabase-cost run returned non-message task content: ${result.content.type}`,
    )

    const streamedTasks = [...streamStats.entries()].filter(([, stats]) => stats.textDeltaCount > 0)
    assert(streamedTasks.length > 0, 'No text-delta chunks were observed for delegated proxy run')
    const [streamedTaskId, bestStats] = streamedTasks.sort(
      (a, b) => b[1].textDeltaCount - a[1].textDeltaCount,
    )[0]!
    assert(
      bestStats.textDeltaCount >= 2,
      `Expected streaming with >=2 text chunks, got ${bestStats.textDeltaCount}`,
    )
    assert(
      bestStats.totalTextChars > 20,
      `Expected streamed output length > 20 chars, got ${bestStats.totalTextChars}`,
    )
    assert(
      bestStats.semanticChunkCount >= 2,
      `Expected at least 2 semantic streamed chunks, got ${bestStats.semanticChunkCount}`,
    )

    let taskMetaWithCosts: Record<string, unknown> | null = null
    let lastSeenMeta: Record<string, unknown> | null = null
    for (let i = 0; i < 15; i++) {
      const meta = (await ty.getMeta(streamedTaskId)) as Record<string, unknown> | null
      lastSeenMeta = meta
      if (meta && typeof meta['taskCosts'] === 'number') {
        taskMetaWithCosts = meta
        break
      }
      await sleep(2000)
    }

    assert(
      taskMetaWithCosts !== null,
      `No taskCosts metadata found on chatCompletion task after delegated proxy run. streamedTaskId=${streamedTaskId}, streamStats=${JSON.stringify(
        bestStats,
      )}, lastMeta=${JSON.stringify(lastSeenMeta)}`,
    )
    const taskCosts = taskMetaWithCosts['taskCosts'] as number
    assert(taskCosts >= 0, `Expected taskCosts >= 0 in task metadata, got ${taskCosts}`)

    return {
      taskList,
      result,
      streaming: {
        streamedTaskId,
        ...bestStats,
        allStreamedTasks: Object.fromEntries(streamedTasks),
      },
      taskMetadata: {
        streamedTaskId,
        taskCosts,
        taskMetaWithCosts,
      },
    }
  } finally {
    stopStreamProbe()
    await tystate.setProviderApiKey('taskyon', prevTaskyonKey as KeyString | undefined)
    state.setLLMSettings('selectedApi', prevSelectedApi || 'taskyon')
  }
}
testChatCompletionTaskyonProxyMintSupabaseCosts.description =
  'test delegated proxy chatCompletion and verify completion costs are attached as task metadata'

export const testChatCompletionTaskyonProxyMetadata = async (ctx?: { tyauth?: string }) => {
  const ty = await tystate.taskyon
  const prevSelectedApi = state.llmSettings.selectedApi
  const prevTaskyonKey = tystate.getTaskyonKeyString()
  const tyauth = ctx?.tyauth

  assert(
    typeof tyauth === 'string' && tyauth.length > 0,
    'Missing tyauth. This test must be called with the normal test context: { tyauth }',
  )

  await tystate.setProviderApiKey('taskyon', tyauth as KeyString)
  state.setLLMSettings('selectedApi', 'taskyon')

  try {
    const taskList: partialTaskDraft[][] = [
      [
        {
          role: 'user',
          content: {
            type: 'message',
            data: 'Write two short lines saying delegated proxy backend streaming is active. Plain text only.',
          },
        },
        createChatCompletionTask({
          goal: 'SimpleCompletion',
          model: 'google/gemini-2.5-flash-lite',
          llmTools: false,
        }),
      ],
    ]

    const result = await processTasks(tystate.api)(taskList, ['message', 'return'], {
      timeoutMs: 20000,
    })
    assert(
      result.content.type === 'message',
      `Delegated proxy metadata run returned non-message task content: ${result.content.type}`,
    )
    assert(
      typeof result.parentID === 'string' && result.parentID.length > 0,
      `Expected result.parentID to point at the chatCompletion task id, got: ${String(result.parentID)}`,
    )

    const taskId = result.parentID
    let taskMeta: Record<string, unknown> | null = null
    for (let i = 0; i < 15; i++) {
      const meta = (await ty.getMeta(taskId)) as Record<string, unknown> | null
      const hasCoreMeta =
        !!meta &&
        Array.isArray(meta['taskPrompt']) &&
        typeof meta['rawOutput'] === 'object' &&
        meta['rawOutput'] !== null &&
        typeof meta['streamContent'] === 'string'
      if (hasCoreMeta) {
        taskMeta = meta
        break
      }
      await sleep(2000)
    }

    assert(taskMeta !== null, `No expected chatCompletion metadata found for task ${taskId}`)
    assert(
      Array.isArray(taskMeta['tools']),
      `Expected metadata.tools to be an array for task ${taskId}`,
    )

    return {
      taskList,
      result,
      taskMetadata: {
        taskId,
        keys: Object.keys(taskMeta),
        taskMeta,
      },
    }
  } finally {
    await tystate.setProviderApiKey('taskyon', prevTaskyonKey as KeyString | undefined)
    state.setLLMSettings('selectedApi', prevSelectedApi || 'taskyon')
  }
}
testChatCompletionTaskyonProxyMetadata.description =
  'test delegated proxy chatCompletion and verify metadata exists on the resulting task using provided tyauth'

export const testFileUpload = async () => {
  const testPdf = await urlToFile('/tests/product_specs_long.pdf')

  const id = await tystate.addFile(testPdf)
  console.log('finished sending file!', id)

  const tasks: partialTaskDraft[] = [
    {
      role: 'system',
      content: { type: 'files', data: [id] },
    },
    createChatCompletionTask({
      prompts: ['The user just uploaded a file, can you extract the data below?'],
      options: { verbosity: 'high' },
      reasoning_effort: 'low',
      llmTools: false,
      //reasoning_effort: undefined,
      model: 'google/gemini-2.5-flash-lite',
      schema: {
        type: 'object',
        properties: {
          weight: {
            type: 'string',
            description: 'the weight of the product',
          },
          price: { type: 'string', description: 'The price of the product.' },
        },
        additionalProperties: false,
        required: ['weight', 'price'],
      },
    }),
  ]

  tystate.api.receive((msg) => {
    console.log('upload file test received message', msg)
  })

  const taskResult = await processTasks(tystate.api)([tasks], 'structured', { timeoutMs: 20000 })

  const res = taskResult.content.data as { weight?: string; price?: string }

  assert(res.price === '$349', 'wrong price')
  assert(res.weight === '2.3 kg', 'wrong weight')

  console.log('client received result:')
  return {
    tasks,
    taskResult,
    res,
  }
}

export const testMetaDb = async () => {
  const ty = await tystate.taskyon
  const id = 'meta_diagnostics_test'
  await ty.metaUpsert(id, { name: 'lets test!' }, 'shallow_merge')
  await ty.metaUpsert(id, {}, 'shallow_merge')
  await ty.metaUpsert(
    id,
    { summary: 'this should normally work! and be added to the name!' },
    'shallow_merge',
  )
  const result = await ty.getMeta(id)
  return {
    result,
  }
}
testMetaDb.description = 'test meta database'

export const testPGLite = async () => {
  const db = await getDatabase('chatStore')
  return {
    db,
    pgvector: await db.exec('CREATE EXTENSION IF NOT EXISTS vector;'),
    createTable: await db.exec(`
      CREATE TABLE IF NOT EXISTS test (
        id SERIAL PRIMARY KEY,
        task TEXT,
        vec vector(3),
        done BOOLEAN DEFAULT false
      );
      INSERT INTO test (task, done) VALUES ('Install PGlite from NPM', true);
      INSERT INTO test (task, done) VALUES ('Load PGlite', true);
      INSERT INTO test (task, done) VALUES ('Create a table', true);
      INSERT INTO test (task, done) VALUES ('Insert some data', true);
      INSERT INTO test (task) VALUES ('Update a task');
      INSERT INTO test (task, vec) VALUES ('test1', '[1,2,3]');
      INSERT INTO test (task, vec) VALUES ('test2', '[4,5,6]');
      INSERT INTO test (task, vec) VALUES ('test3', '[7,8,9]');
    `),
    query: await db.sql`SELECT * from test WHERE id = 1;`,
    'vector query': await db.exec(`
      SELECT
        task,
        vec,
        vec <-> '[3,1,2]' AS distance
      FROM test;
    `),
  }
}

export const testIPFS = () => {
  const markdownContent =
    '# Sample Markdown\n\nThis is a sample markdown file generated by Taskyon to test Gdrive functionality.\n\n' +
    new Date().toISOString()

  /*const { exportToIpfs } = await useIpfs()

  const cid = await exportToIpfs(markdownContent)*/

  return {
    markdownContent,
  }

  //throw { message: 'could not found the task we just loaded!!' };
}

const mockTask: TaskNode = {
  role: 'assistant',
  id: 'test',
  content: { type: 'message', data: 'Sample content for task node' },
}

const mockChatMessages: OpenAIMessage[] = [
  { role: 'user', content: 'Hello, how are you?' },
  { role: 'assistant', content: "I'm good, thank you!" },
]

const mockTools: Record<string, ToolBase> = {
  tool1: {
    name: 'tool1',
    description: 'Tool 1 description',
    parameters: {
      type: 'object',
      properties: {
        param1: {
          type: 'string',
          description: 'some parameter1.',
        },
      },
      required: ['param1'],
    },
  },
  tool2: {
    name: 'tool2',
    description: 'Tool 2 description',
    parameters: {
      type: 'object',
      properties: {
        param2: {
          type: 'string',
          description: 'some parameter2.',
        },
      },
    },
  },
}

export async function testTransformersPipeline() {
  const { pipeline } = await import('@huggingface/transformers')
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  const output = await extractor('This is a simple test.', {
    pooling: 'mean',
    quantize: true,
    precision: 'binary',
  })
  /* Tensor {
  //   type: 'int8',
  //   data: Int8Array[49, 108, 24, ...],
  //   dims: [1, 48]
  }*/
  return output
}

export async function testVectorizerInitialization() {
  const nlpWorker = useNlpWorker()
  const modelName = state.llmSettings.vectorizationModel // Mock model name
  await nlpWorker.loadVecModel(modelName)
  await nlpWorker.loadVecTokenizer(modelName)
  return 'success'
}

export async function testVectorizeText() {
  const nlpWorker = useNlpWorker()
  const testText = 'Sample text for vectorization'
  const modelName = state.llmSettings.vectorizationModel // Mock model name
  const vector = await nlpWorker.vectorizeText(testText, modelName)
  const testSum = vector?.reduce((p, c) => p + c, 0)
  console.log('Vectorize Text Result Test Sum:', testSum)
  return testSum
}

export async function testEstimateChatTokens() {
  const nlpWorker = useNlpWorker()

  const tokens = await nlpWorker.estimateChatTokens(
    mockTask.content,
    mockChatMessages,
    mockTools,
    Object.values(mockTools).map((tool) => tool.name),
  )
  console.log('Estimate Chat Tokens Result:', tokens)
  return tokens
}

function shuffleKeys<T>(obj: T): T {
  const sobj = deepCloneWJson(obj)
  if (Array.isArray(sobj) || sobj === null || typeof sobj !== 'object') {
    return sobj
  }

  const entries = Object.entries(sobj)
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = entries[j]!
    entries[j] = entries[i]!
    entries[i] = tmp
  }

  const shuffled = Object.fromEntries(entries.map(([k, v]) => [k, shuffleKeys(v)]))

  return shuffled as T
}

async function shouldProduceError(func: (...args: unknown[]) => unknown) {
  let error: Error | undefined = undefined
  try {
    await func()
  } catch (err) {
    console.log('correctly produces error:', err)
    error = err as Error
  }
  if (error) return error
  else throw new Error(`Operation ${func.name} should produce an error!`)
}

export async function testTaskIdHashing() {
  const testTask: partialTaskDraft = {
    role: 'user',
    name: 'test',
    content: {
      type: 'message',
      data: 'test',
    },
    parentID: undefined, // should be stripped away
  }

  const fullTask = await createTaskNode(testTask, { createMeta: 'missing' })

  const cloneTask = deepCloneWJson(testTask)
  delete cloneTask.parentID
  cloneTask.created_at = fullTask.created_at
  const strippedTask = await createTaskNode(cloneTask, { createMeta: 'missing' })
  assert(strippedTask.id === fullTask.id, 'strippedTask should be the same as "fullTask" !!!')

  const noIdTask = removeKeys(fullTask, ['id'])
  await sleep(10) // sleeping for ms to make sure we have different creation times
  const ft2 = await createTaskNode(noIdTask, { createMeta: 'missing' })
  await sleep(10) // sleeping for ms to make sure we have different creation times
  const ft3 = await createTaskNode(noIdTask)
  await sleep(10) // sleeping for ms to make sure we have different creation times
  // we remove the keys in the next example in order to be able to overwrite metadata
  const updatedTask = await createTaskNode(noIdTask, { createMeta: 'overwrite' })
  const err1 = await shouldProduceError(() =>
    createTaskNode({ ...updatedTask, id: fullTask.id }, { createMeta: 'overwrite' }),
  )
  await sleep(10) // sleeping for ms to make sure we have different creation times
  const ft4 = await createTaskNode(testTask, { createMeta: 'missing' })

  assert(fullTask.id === ft2.id, 'ft2 should match fullTask')
  assert(fullTask.id === ft3.id, 'ft3 should match fullTask')
  assert(fullTask.id !== ft4.id, 'ft4 should not match fullTask')

  // ---- Now shuffle key order ----
  const shuffledTask = removeKeys(shuffleKeys(fullTask), ['id'])
  await sleep(10) // sleeping for ms to make sure we have different creation times
  const sft2 = await createTaskNode(shuffledTask, { createMeta: 'missing' })
  await sleep(10) // sleeping for ms to make sure we have different creation times
  const sft3 = await createTaskNode(shuffledTask)
  await sleep(10) // sleeping for ms to make sure we have different creation times
  const err3 = await shouldProduceError(() =>
    createTaskNode({ ...shuffledTask, id: ft4.id }, { createMeta: 'overwrite' }),
  )

  assert(fullTask.id === sft2.id, 'shuffled ft2 should match')
  assert(fullTask.id === sft3.id, 'shuffled ft3 should match')

  return {
    expectedErrors: { err1: err1.message, err3: err3.message },
    testTask,
    fullTask,
    shuffledTask,
  }
}

export async function markdownGeneration() {
  const ty = await tystate.taskyon
  // first load the chat as mardown
  const yamlContent = await getTextFile('/tests/test_conversation.yaml')
  const lastLoadedTaskId = await ty.loadYamlConversation(yamlContent)
  //const newTaskId = await state.addMdTasks(markdownContent, undefined);
  // and delete this conversation again :)
  if (lastLoadedTaskId) {
    const taskList = await ty.getTaskChain(lastLoadedTaskId)
    const markdown = chat2Md(taskList)
    await ty.deleteTaskThread(lastLoadedTaskId)
    return {
      markdown,
    }
  }
  throw new Error('could not find the task we just loaded!!')
}

export function testJsonSchemaToYaml() {
  const schema: JSONSchema7 = {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'identifier' },
      count: { type: 'number', default: 0, description: 'counter' },
      tags: { type: 'array', items: { type: 'string' }, description: 'labels' },
      meta: {
        type: 'object',
        properties: {
          flag: { type: 'boolean' },
          tier: { enum: ['free', 'pro', 'enterprise'], description: 'user tier' },
        },
        description: 'metadata',
      },
    },
  }
  const postfix = ' (optional)'
  const out = jsonSchemaToYamlString(schema, postfix)

  const expected = `\
# identifier
id: string
# counter${postfix}
count: number
# labels${postfix}
tags:
  type: array
  items: string
# metadata${postfix}
meta:
  flag: boolean
  # user tier${postfix}
  tier: free|pro|enterprise
`

  if (out.trim() !== expected.trim()) {
    throw new Error(`
YAML output doesn’t match expected snapshot!

— expected —
${expected}

— received —
${out}
    `)
  }

  console.log('✅ test passed')
  return { out }
}

export async function getTestMetaData() {
  async function completionMessage() {
    const ty = await tystate.taskyon
    const tyChat: Record<string, unknown> = {
      chatID: state.llmSettings.selectedTaskId,
    }
    if (state.llmSettings.selectedTaskId) {
      tyChat.taskIdChain = await ty.getTaskIdChain(state.llmSettings.selectedTaskId)
      const task = await ty.getTask(state.llmSettings.selectedTaskId)
      if (task) {
        const taskChain = await ty.getTaskChain(task.id)
        const toolDefs = await ty.updateToolDefinitions(false)
        const res = await convertTaskNodesToOpenAIChat(
          taskChain,
          // we are not testing files right now...
          () => new Promise(() => null),
          () => new Promise(() => undefined),
          !!state.toolchainConfig.chatCompletion?.use_multimodal,
          !!state.toolchainConfig.chatCompletion?.llmTools,
          toolDefs,
        )
        tyChat.thread = res
      }
    }
    return tyChat
  }

  const currentProfilePointer = getCurrentActiveProfileName()
  return safeYamlDump({
    browserInfo: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      appName: navigator.appName,
      appVersion: navigator.appVersion,
      vendor: navigator.vendor,
      'crypto.subtle': crypto.subtle ? 'available' : 'not available',
    },
    windowInfo: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      colorDepth: window.screen.colorDepth,
    },
    appInfo: {
      appConfiguration: state.appConfiguration,
    },
    taskyonStoreDiagnostics: {
      currentProfilePointer,
      SavedState: currentProfilePointer ? getStoredStateString(currentProfilePointer) : 'N/A',
      CurrentState: state.getStateValues(),
    },
    CurrentChat: await completionMessage(),
  })
}
