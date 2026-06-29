import { createHash, createHmac } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { stdin as input, stdout as output, env } from 'node:process'

const LIBRARIES_JSON_PATH = resolve('packages/shared/modelica/modelica_libraries.json')
const CACHE_DIR = resolve(env.TASKYON_MODELICA_LIBRARY_CACHE_DIR || '.tmp/modelica-libraries')
const FORCE_DOWNLOAD = env.TASKYON_MODELICA_FORCE_DOWNLOAD === '1'
const SECRET_SERVICE = 'taskyon-modelica-libraries'
const SECRET_KEYS = {
  publicBaseUrl: 'TASKYON_MODELICA_PUBLIC_BASE_URL',
  s3BucketUrl: 'TASKYON_MODELICA_S3_BUCKET_URL',
  bucket: 'TASKYON_MODELICA_S3_BUCKET',
  baseUrl: 'TASKYON_MODELICA_ASSET_BASE_URL',
  prefix: 'TASKYON_MODELICA_S3_PREFIX',
  endpointUrl: 'AWS_ENDPOINT_URL',
  accessKeyId: 'AWS_ACCESS_KEY_ID',
  secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
}

function sanitizeFileStem(value) {
  const stem = String(value || '')
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
  return stem.length > 0 ? stem : 'library'
}

function normalizePrefix(value) {
  return String(value || '')
    .trim()
    .replaceAll(/^\/+|\/+$/g, '')
}

function normalizeBaseUrl(value) {
  return String(value || '')
    .trim()
    .replaceAll(/\/+$/g, '')
}

function buildCachePath(fileName) {
  return join(CACHE_DIR, fileName)
}

function buildMirrorKey(prefix, libraryId, sha256) {
  return [prefix, libraryId, `${sha256}.zip`].filter(Boolean).join('/')
}

function buildManifestKey(prefix) {
  return [prefix, 'modelica_libraries.json'].filter(Boolean).join('/')
}

function buildMirrorUrl(baseUrl, key) {
  return `${normalizeBaseUrl(baseUrl)}/${key}`
}

function hasArg(name) {
  return process.argv.slice(2).includes(name)
}

function debugLog(message, details = undefined) {
  if (details === undefined) {
    console.log(`[modelica-libraries:debug] ${message}`)
    return
  }
  console.log(`[modelica-libraries:debug] ${message}`, details)
}

function redactHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const normalized = key.toLowerCase()
      if (normalized === 'authorization') return [key, '<redacted>']
      if (normalized.includes('secret')) return [key, '<redacted>']
      return [key, value]
    }),
  )
}

function isSecretKey(key) {
  return key === SECRET_KEYS.accessKeyId || key === SECRET_KEYS.secretAccessKey
}

function normalizeConfigValue(key, value) {
  const trimmed = String(value || '').trim()
  if (key === SECRET_KEYS.accessKeyId || key === SECRET_KEYS.secretAccessKey) {
    return trimmed.replaceAll(/\s+/g, '')
  }
  return trimmed
}

async function promptValue(label, options = {}) {
  const rl = createInterface({ input, output })
  if (options.secret) {
    const originalWrite = rl._writeToOutput
    rl._writeToOutput = function writeHidden(value) {
      if (rl.stdoutMuted) rl.output.write('*')
      else originalWrite.call(rl, value)
    }
    rl.stdoutMuted = true
  }
  try {
    if (options.description) {
      output.write(`${options.description}\n`)
    }
    const defaultHint = options.defaultValue ? ` [${options.defaultValue}]` : ''
    const value = await rl.question(`${label}${defaultHint}: `)
    if (options.secret) output.write('\n')
    if (!value.trim() && options.defaultValue) return options.defaultValue
    return value.trim()
  } finally {
    rl.close()
  }
}

async function execSecretTool(args, inputValue = '') {
  return await new Promise((resolve) => {
    const child = execFile('secret-tool', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
    if (inputValue) child.stdin?.end(`${inputValue}\n`)
  })
}

async function lookupSecret(key) {
  const result = await execSecretTool(['lookup', 'service', SECRET_SERVICE, 'key', key])
  if (result.error) return ''
  return String(result.stdout || '').trim()
}

async function storeSecret(key, value) {
  const normalized = normalizeConfigValue(key, value)
  if (!normalized) return
  const label = `Taskyon Modelica S3 ${key}`
  const result = await execSecretTool(
    ['store', '--label', label, 'service', SECRET_SERVICE, 'key', key],
    normalized,
  )
  if (result.error) {
    console.warn(
      `[modelica-libraries] could not store ${key} in Secret Service: ${
        result.stderr || result.error.message
      }`,
    )
  }
}

async function resolveConfigValue(key, options = {}) {
  const envValue = normalizeConfigValue(key, env[key])
  if (envValue) return envValue

  const secretValue = normalizeConfigValue(key, await lookupSecret(key))
  if (secretValue) return secretValue

  const label = options.label || key
  const value = await promptValue(label, {
    ...options,
    defaultValue: options.defaultValue || '',
    secret: isSecretKey(key),
  })
  const normalized = normalizeConfigValue(key, value)
  if (normalized) await storeSecret(key, normalized)
  return normalized
}

function parseS3BucketUrl(rawUrl) {
  const normalized = String(rawUrl || '').trim()
  try {
    const url = new URL(normalized)
    const bucket = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''))
    if (!bucket) throw new Error('missing bucket path')
    return { endpointUrl: url.origin, bucket }
  } catch (error) {
    throw new Error(
      `S3 bucket URL must look like https://host.example.com/bucket-name (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}

async function promptConfig() {
  const legacyBucket =
    String(env[SECRET_KEYS.bucket] || '').trim() || (await lookupSecret(SECRET_KEYS.bucket))
  const legacyBaseUrl =
    String(env[SECRET_KEYS.baseUrl] || '').trim() || (await lookupSecret(SECRET_KEYS.baseUrl))
  const legacyEndpointUrl =
    String(env[SECRET_KEYS.endpointUrl] || '').trim() ||
    (await lookupSecret(SECRET_KEYS.endpointUrl))
  const publicBaseUrl =
    legacyBaseUrl ||
    (await resolveConfigValue(SECRET_KEYS.publicBaseUrl, {
      label: 'Public S3 mirror base URL',
      description:
        'Public S3 mirror base URL: browser-visible URL where uploaded library files and the manifest can be downloaded. This is not the original upstream library URL from the JSON manifest.',
    }))
  const bucketUrl =
    legacyBucket && legacyEndpointUrl
      ? ''
      : await resolveConfigValue(SECRET_KEYS.s3BucketUrl, {
          label: 'S3 bucket URL',
          description:
            'S3 bucket URL: API URL for the target bucket used for signed uploads. The script derives the S3 endpoint from the origin and the bucket name from the path.',
        })
  const parsed = bucketUrl ? parseS3BucketUrl(bucketUrl) : undefined
  const bucket = legacyBucket || parsed?.bucket || ''
  const endpointUrl = legacyEndpointUrl || parsed?.endpointUrl || ''
  const prefix = normalizePrefix(env[SECRET_KEYS.prefix])
  if (endpointUrl) env.AWS_ENDPOINT_URL = endpointUrl

  env.AWS_ACCESS_KEY_ID = await resolveConfigValue(SECRET_KEYS.accessKeyId, {
    label: 'S3 access key ID',
    description: 'S3 access key ID: the access key identifier for the S3-compatible credentials.',
  })
  env.AWS_SECRET_ACCESS_KEY = await resolveConfigValue(SECRET_KEYS.secretAccessKey, {
    label: 'S3 secret access key',
    description: 'S3 secret access key: the private secret paired with the S3 access key ID.',
  })
  const config = {
    bucket: bucket.trim(),
    baseUrl: normalizeBaseUrl(publicBaseUrl),
    prefix,
    endpointUrl: normalizeBaseUrl(endpointUrl),
  }
  debugLog('resolved upload config', {
    bucket: config.bucket,
    endpointUrl: config.endpointUrl,
    publicBaseUrl: config.baseUrl,
    prefix: config.prefix || '<none>',
    accessKeyIdSuffix: env.AWS_ACCESS_KEY_ID ? env.AWS_ACCESS_KEY_ID.slice(-6) : '<missing>',
  })
  return config
}

async function promptManifestConfig() {
  const baseUrl =
    String(env[SECRET_KEYS.baseUrl] || '').trim() ||
    (await lookupSecret(SECRET_KEYS.baseUrl)) ||
    (await resolveConfigValue(SECRET_KEYS.publicBaseUrl, {
      label: 'Public S3 mirror base URL',
      description:
        'Public S3 mirror base URL: browser-visible URL where uploaded library files and the manifest can be downloaded. This is not the original upstream library URL from the JSON manifest.',
    }))
  const prefix = normalizePrefix(env[SECRET_KEYS.prefix])
  return { bucket: '', baseUrl: normalizeBaseUrl(baseUrl), prefix }
}

async function readManifest() {
  const jsonText = await readFile(LIBRARIES_JSON_PATH, 'utf8')
  const parsed = JSON.parse(jsonText)
  const libraries = Array.isArray(parsed?.libraries) ? parsed.libraries : []
  return { manifest: parsed, libraries }
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function downloadToPath(url, targetPath) {
  await mkdir(dirname(targetPath), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength <= 1024) throw new Error('download failed: response is unexpectedly small')
  await writeFile(targetPath, bytes)
}

async function ensureDownloaded(library, targetPath) {
  if (!FORCE_DOWNLOAD && (await fileExists(targetPath))) {
    console.log(`[modelica-libraries] using cached ${targetPath}`)
    return
  }
  console.log(`[modelica-libraries] downloading ${library.download_url}`)
  await downloadToPath(library.download_url, targetPath)
}

async function hashFile(path) {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

function awsDateParts(date = new Date()) {
  const compact = date.toISOString().replaceAll(/[:-]|\.\d{3}/g, '')
  return {
    amzDate: compact,
    dateStamp: compact.slice(0, 8),
  }
}

function hashHex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding)
}

function deriveRegion(endpointUrl) {
  const explicit = String(env.AWS_REGION || env.AWS_DEFAULT_REGION || '').trim()
  if (explicit) return explicit
  try {
    const region = new URL(endpointUrl).hostname.split('.')[0] || ''
    return /^[a-z]{2}\d?$/.test(region) ? region : 'us-east-1'
  } catch {
    return 'us-east-1'
  }
}

function encodeS3PathSegment(value) {
  return encodeURIComponent(value).replaceAll('%2F', '/').replaceAll('%3A', ':')
}

function buildS3ObjectUrl(config, key) {
  const endpoint = normalizeBaseUrl(config.endpointUrl || env.AWS_ENDPOINT_URL)
  if (!endpoint) throw new Error('S3 endpoint URL is missing')
  const bucketPath = encodeS3PathSegment(config.bucket)
  const keyPath = key
    .split('/')
    .map((part) => encodeS3PathSegment(part))
    .join('/')
  return new URL(`${endpoint}/${bucketPath}/${keyPath}`)
}

function signS3Request({ method, url, headers, payloadHash, region }) {
  const accessKeyId = String(env.AWS_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(env.AWS_SECRET_ACCESS_KEY || '').trim()
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('S3 access key ID and secret access key are required')
  }

  const { amzDate, dateStamp } = awsDateParts()
  const requestHeaders = {
    ...headers,
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  const sortedHeaderNames = Object.keys(requestHeaders)
    .map((name) => name.toLowerCase())
    .sort()
  const normalizedHeaders = sortedHeaderNames.reduce((acc, name) => {
    acc[name] = String(requestHeaders[name] ?? requestHeaders[name.toLowerCase()] ?? '')
      .trim()
      .replaceAll(/\s+/g, ' ')
    return acc
  }, {})
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${normalizedHeaders[name]}\n`)
    .join('')
  const signedHeaders = sortedHeaderNames.join(';')
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashHex(canonicalRequest),
  ].join('\n')
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'),
    'aws4_request',
  )
  const signature = hmac(signingKey, stringToSign, 'hex')
  debugLog('signing request', {
    method,
    url: url.href,
    region,
    signedHeaders,
    payloadHash,
    canonicalRequest,
    stringToSign,
  })
  return {
    ...requestHeaders,
    Authorization: [
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', '),
  }
}

async function remoteObjectMatches(config, key, sizeBytes, sha256) {
  const url = buildS3ObjectUrl(config, key)
  const region = deriveRegion(config.endpointUrl)
  const payloadHash = hashHex('')
  const headers = signS3Request({
    method: 'HEAD',
    url,
    headers: {},
    payloadHash,
    region,
  })
  debugLog('HEAD request', {
    url: url.href,
    headers: redactHeaders(headers),
    expectedSize: sizeBytes,
    expectedSha256: sha256,
  })
  const response = await fetch(url, { method: 'HEAD', headers })
  debugLog('HEAD response', {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  })
  if (!response.ok) return false
  const remoteSize = Number(response.headers.get('content-length') || '')
  const remoteSha = String(response.headers.get('x-amz-meta-sha256') || '').trim()
  return remoteSize === sizeBytes && remoteSha === sha256
}

async function uploadFile({ config, key, path, contentType, cacheControl, sha256 }) {
  const body = await readFile(path)
  const payloadHash = hashHex(body)
  const url = buildS3ObjectUrl(config, key)
  const region = deriveRegion(config.endpointUrl)
  const unsignedHeaders = {
    'cache-control': cacheControl,
    'content-type': contentType,
    ...(sha256 ? { 'x-amz-meta-sha256': sha256 } : {}),
  }
  const headers = signS3Request({
    method: 'PUT',
    url,
    headers: unsignedHeaders,
    payloadHash,
    region,
  })
  debugLog('PUT request', {
    url: url.href,
    headers: redactHeaders(headers),
    bodyBytes: body.byteLength,
  })
  const response = await fetch(url, { method: 'PUT', headers, body })
  const responseText = response.ok ? '' : await response.text()
  debugLog('PUT response', {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    body: responseText,
  })
  if (!response.ok) {
    throw new Error(`S3 upload failed for ${key}: HTTP ${response.status} ${responseText}`)
  }
}

function normalizeLibrary(entry) {
  const name = String(entry?.name || '').trim()
  const id = String(entry?.id || sanitizeFileStem(name)).trim()
  const fileName = String(entry?.file_name || `${id}.zip`).trim()
  const downloadUrl = String(entry?.download_url || '').trim()
  return { ...entry, id, file_name: fileName, download_url: downloadUrl }
}

async function mirrorLibrary(entry, config, options) {
  const library = normalizeLibrary(entry)
  if (!library.download_url)
    throw new Error(`Missing download_url for ${library.name || library.id}`)
  if (library.mirror === false) return library

  const cachePath = buildCachePath(library.file_name)
  await ensureDownloaded(library, cachePath)
  const [{ size }, sha256] = await Promise.all([stat(cachePath), hashFile(cachePath)])
  const mirrorKey = buildMirrorKey(config.prefix, library.id, sha256)
  const mirrorUrl = buildMirrorUrl(config.baseUrl, mirrorKey)

  if (options.upload) {
    const matches = await remoteObjectMatches(config, mirrorKey, size, sha256)
    if (matches) {
      console.log(`[modelica-libraries] mirror already current: ${mirrorKey}`)
    } else {
      console.log(`[modelica-libraries] uploading ${mirrorKey}`)
      await uploadFile({
        config,
        key: mirrorKey,
        path: cachePath,
        contentType: 'application/zip',
        cacheControl: 'public, max-age=31536000, immutable',
        sha256,
      })
    }
  }

  return {
    ...library,
    mirror: true,
    mirror_key: mirrorKey,
    mirror_url: mirrorUrl,
    size_bytes: size,
    sha256,
    mirrored_at: new Date().toISOString(),
  }
}

async function writeManifest(manifest) {
  await writeFile(LIBRARIES_JSON_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function publishManifest(config) {
  const key = buildManifestKey(config.prefix)
  console.log(`[modelica-libraries] uploading manifest ${key}`)
  await uploadFile({
    config,
    key,
    path: LIBRARIES_JSON_PATH,
    contentType: 'application/json',
    cacheControl: 'public, max-age=300',
  })
}

async function main() {
  const upload = !hasArg('--no-upload')
  const config = upload ? await promptConfig() : await promptManifestConfig()
  if (!config.baseUrl) {
    throw new Error('TASKYON_MODELICA_ASSET_BASE_URL is required')
  }

  const { manifest, libraries } = await readManifest()
  const mirroredLibraries = []
  for (const entry of libraries) {
    mirroredLibraries.push(await mirrorLibrary(entry, config, { upload }))
  }
  const nextManifest = {
    ...manifest,
    generated_on: new Date().toISOString(),
    mirror_manifest_url: buildMirrorUrl(config.baseUrl, buildManifestKey(config.prefix)),
    libraries: mirroredLibraries,
  }
  await writeManifest(nextManifest)
  if (upload) await publishManifest(config)
  console.log(`[modelica-libraries] updated ${LIBRARIES_JSON_PATH}`)
}

main().catch((err) => {
  console.error(`[modelica-libraries] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
