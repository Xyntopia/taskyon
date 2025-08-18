/**
 * This file contains a few functions to deal with gdrive synchronization
 *
 * check out this URL for documentation:  https://developers.google.com/drive/api/reference/rest/v3?authuser=1
 */

import { ref, computed, watch } from 'vue'
import axios from 'axios'
import { googleSdkLoaded } from 'vue3-google-login'
import { sleep } from 'src/modules/utils'
import { asyncLruCache } from 'src/modules/utils'
import { LocalStorage } from 'quasar'
import { zipSync } from 'fflate'

type gDriveFile = {
  kind: string //"drive#file",
  id: string //"1G4SJ8bBP13mNRWp9CIzeYNKsjc_q8BHP",
  name: string //"taskyon/templates.json",
  mimeType: string //"application/json"
  webViewLink?: string // optionally a pulic link of the file
}

export const clientId = '14927198496-jaadcashh91s9gue7uicf3datk79tohc.apps.googleusercontent.com'
export const scope = 'https://www.googleapis.com/auth/drive.file'

// we can use this function to pack multiple files into a single file
// in gdrive and mark them using the hashprops! so that we know
// where individual files are!
const MAX_APP_PROPS = 30
const MAX_PUB_PROPS = 30
const MAX_TOTAL_PROPS = MAX_APP_PROPS + MAX_PUB_PROPS

// choose a safe prefix:
const PROP_PREFIX = 'f.' // instead of 'f:'

// optional: assert the filename itself is Drive-key safe
const DRIVE_KEY_SAFE = /^[A-Za-z0-9.!@$%^&*()_/ -]+$/

function assertDriveKeySafeFilename(name: string) {
  if (!DRIVE_KEY_SAFE.test(name)) {
    // your filenames are hashes, so this should never trigger.
    // if it does, either sanitize or bail loudly:
    throw new Error(`Filename contains chars not allowed in Drive property keys: ${name}`)
  }
}

function buildNameProps(names: string[]) {
  const appProps: Record<string, string> = {}
  const pubProps: Record<string, string> = {}
  let i = 0
  for (const n of names) assertDriveKeySafeFilename(n)
  for (; i < names.length && i < MAX_APP_PROPS; i++) appProps[`${PROP_PREFIX}${names[i]}`] = '1'
  for (; i < names.length && i < MAX_APP_PROPS + MAX_PUB_PROPS; i++)
    pubProps[`${PROP_PREFIX}${names[i]}`] = '1'
  return { appProps, pubProps }
}

async function blobsToZip(files: Array<{ name: string; blob: Blob }>): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) entries[f.name] = new Uint8Array(await f.blob.arrayBuffer())
  const zipped = zipSync(entries, { level: 6 }) // balanced speed/ratio
  return new Blob([zipped], { type: 'application/zip' })
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export const useGdrive = () => {
  const maxTokenAgeMinutes = 55
  const tyGdAccessStorageName = 'tygd'
  const savedToken = String(LocalStorage.getItem(tyGdAccessStorageName))
  const gdriveAccessToken = ref<string>(savedToken) // Store the access token
  watch(gdriveAccessToken, (n) => LocalStorage.set(tyGdAccessStorageName, n ?? ''))

  const tokenReceivedTime = ref(0) // Unix timestamp of when the token was received

  const isTokenExpired = computed(() => {
    const currentTime = Math.floor(Date.now() / 1000) // Current Unix timestamp in seconds
    const tokenAgeSeconds = currentTime - tokenReceivedTime.value
    return tokenAgeSeconds > maxTokenAgeMinutes * 60 // Convert minutes to seconds
  })

  function setTokenReceivedTime() {
    tokenReceivedTime.value = Math.floor(Date.now() / 1000) // Set to current Unix timestamp
  }

  type TokenClient = {
    requestAccessToken: (overridableClientConfig?: Record<string, unknown>) => void
  }

  function initializeTokenClient(): Promise<TokenClient> {
    return new Promise((resolve) => {
      googleSdkLoaded((google) => {
        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: scope,
        })
        console.log('initialized gdrive token client')
        resolve(tokenClient)
      })
    })
  }

  // TODO: save the access token for a longer time! :)
  //       maybe just cache it?
  async function getValidAccessToken() {
    if (!gdriveAccessToken.value || isTokenExpired.value) {
      const tokenClient = (await initializeTokenClient()) as unknown as TokenClient & {
        callback: (response: { error: unknown; access_token: string }) => void
      }

      // Request a new token
      tokenClient.callback = (response) => {
        if (response.error) {
          throw new Error('Error refreshing token:', response.error)
        }
        gdriveAccessToken.value = response.access_token // Update the access token
        setTokenReceivedTime() // Update the token received time
      }

      // 'prompt' options for tokenClient.requestAccessToken:
      // 'none' - silent token refresh, fails if user is logged out.
      // 'consent' - forces consent screen, useful for new permissions.
      // 'select_account' - shows account picker if user has multiple Google accounts.
      // '' (default) - lets Google decide based on user session.
      tokenClient.requestAccessToken({ prompt: '' })

      // Wait for the token to be refreshed
      while (isTokenExpired.value) {
        await sleep(1000) // Wait for 1 second before checking again
      }
    }

    return gdriveAccessToken.value // Return the valid access token
  }

  async function saveFileToGdrive(file: Blob, directory: string, filename: string, share = false) {
    const validAccessToken = await getValidAccessToken()
    if (validAccessToken) {
      const gdriveFile = await uploadFileToDrive(
        file,
        directory,
        filename,
        file.type,
        validAccessToken,
      )
      console.log('trying to make file public!')
      if (gdriveFile && share) {
        const response = await makeFilePublic(gdriveFile.id, validAccessToken)
        console.log('made file public:', response)
        const publicGdriveFile = await getFileMetaData(gdriveFile.id, validAccessToken)
        return publicGdriveFile
      }
      return gdriveFile
    } else {
      throw new Error('Failed to obtain a valid access token.')
    }
  }

  async function publishMarkdown(
    markdownContent: string,
    directory: string,
    filename: string,
    share = false,
  ) {
    const markdownFile = new File(
      [markdownContent], // Content as an array (required by File constructor)
      filename, // Filename
      { type: 'text/markdown; charset=UTF-8' }, // MIME type
    )

    const gdriveFile = await saveFileToGdrive(
      markdownFile,
      directory,
      markdownFile.name,
      share, //share
    )

    return gdriveFile
  }

  async function saveObjToGdrive(
    obj: Record<string, unknown>,
    directory: string,
    filename: string,
  ) {
    const jsonString = JSON.stringify(obj)
    const fileBlob = new Blob([jsonString], { type: 'application/json' })

    await saveFileToGdrive(fileBlob, directory, filename)
  }

  async function loadFileFromGdrive(directory: string, fileName: string) {
    const validAccessToken = await getValidAccessToken()
    if (validAccessToken) {
      const fileId = await findFileOrDirectoryId({
        accessToken: validAccessToken,
        fileName,
        directory,
      })

      if (fileId) {
        const file = await downloadFileFromDrive(fileId, validAccessToken)
        return file
      } else {
        throw new Error('File not found in GDrive.')
      }
    } else {
      throw new Error('Failed to obtain a valid access token.')
    }
  }

  async function loadObjFromGdrive(directory: string, fileName: string) {
    // Use loadFileFromGdrive to retrieve the file as a Blob
    const fileBlob = await loadFileFromGdrive(directory, fileName)
    if (!fileBlob) {
      throw new Error(`Failed to load Blob for file "${fileName}".`)
    }

    // Convert Blob to JSON object
    const textContent = await fileBlob.text()
    const obj = JSON.parse(textContent) as Record<string, unknown>
    return obj // Return the parsed object
  }

  async function zipAndUpload(
    files: Array<{ name: string; blob: Blob }>,
    directory: string,
    zipBaseName: string,
    share = false,
  ) {
    if (!files.length) throw new Error('zipAndUpload: no files provided')
    const validAccessToken = await getValidAccessToken()

    // ensure target directory
    const directoryId = await ensureDirectoryExists(directory, validAccessToken)
    if (!directoryId) throw new Error('Failed to create/find directory')

    // split so every chunk’s filenames fit into 60 props
    const parts = chunk(files, MAX_TOTAL_PROPS)

    const results: gDriveFile[] = []
    for (let idx = 0; idx < parts.length; idx++) {
      const part = parts[idx]!
      const zipName = parts.length === 1 ? `${zipBaseName}.zip` : `${zipBaseName}.${idx + 1}.zip`

      // zip
      const zipBlob = await blobsToZip(part)

      // properties (store keys for all names in this zip)
      const names = part.map((f) => f.name)
      const { appProps, pubProps } = buildNameProps(names)

      const fileRec = await pushFile(
        zipName,
        'application/zip',
        directoryId,
        zipBlob,
        validAccessToken,
        { appProperties: appProps, properties: pubProps },
      )

      if (share) {
        await makeFilePublic(fileRec.id, validAccessToken)
        const withLink = await getFileMetaData(fileRec.id, validAccessToken)
        results.push({
          ...fileRec,
          ...(withLink.webViewLink ? { webViewLink: withLink.webViewLink } : {}),
        })
      } else {
        results.push(fileRec)
      }
    }
    return results
  }

  // downloadZipContaining: same key construction
  async function downloadZipContaining(directory: string, filename: string) {
    const validAccessToken = await getValidAccessToken()
    if (!validAccessToken) throw new Error('Failed to obtain a valid access token.')

    const directoryId = await gdrivefindFileOrDirectoryId({
      accessToken: validAccessToken,
      directory,
    })
    if (!directoryId) throw new Error(`Directory "${directory}" not found`)

    assertDriveKeySafeFilename(filename)
    const key = `${PROP_PREFIX}${filename}`

    const q =
      `'${directoryId}' in parents and trashed = false and ` +
      `mimeType != 'application/vnd.google-apps.folder' and (` +
      `appProperties has { key='${key}' } or properties has { key='${key}' }` +
      `)`

    const params = {
      q,
      pageSize: 1,
      orderBy: 'createdTime desc',
      fields: 'files(id,name,createdTime)',
    }
    const headers = { Authorization: `Bearer ${validAccessToken}` }
    const { data } = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers,
      params,
    })

    const hit = data.files?.[0]
    if (!hit) return null
    return await downloadFileFromDrive(hit.id, validAccessToken)
  }

  return {
    saveObjToGdrive,
    loadObjFromGdrive,
    saveFileToGdrive,
    loadFileFromGdrive,
    publishMarkdown,

    zipAndUpload,
    downloadZipContaining,
  }
}

// using this mainly to get the sharable link for a file...
async function getFileMetaData(fileId: string, accessToken: string) {
  // Retrieve the file's metadata to get the webViewLink
  const fileMetadataResponse = await axios.get<gDriveFile>(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const fileMetadata = fileMetadataResponse.data
  console.log('File metadata:', fileMetadata)
  return fileMetadata
}

async function uploadFileToDrive(
  file: Blob,
  directory: string,
  fileName: string,
  mimeType: string,
  accessToken: string,
) {
  console.log('Uploading or updating file')

  // Check if the directory exists, if not, create it
  const directoryId = await ensureDirectoryExists(directory, accessToken)
  if (!directoryId) {
    throw new Error('Error in creating or finding directory.')
  }

  // Check if the file already exists
  const existingFileId = await findFileOrDirectoryId({
    fileName,
    accessToken,
  })

  // Update or create the file
  if (existingFileId) {
    console.log('File exists, updating it')
    return await updateFile(existingFileId, file, mimeType, accessToken)
  } else {
    console.log('File does not exist, creating new file')
    return await pushFile(fileName, mimeType, directoryId, file, accessToken)
  }
}

const fieldsParam = 'fields=webViewLink,id,name,mimeType'

async function updateFile(fileId: string, file: Blob, mimeType: string, accessToken: string) {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?${fieldsParam}&uploadType=multipart`
  const metadata = { mimeType: mimeType }

  const formData = new FormData()
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  formData.append('file', file)

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'multipart/related',
  }

  const response = await axios.patch<gDriveFile>(url, formData, { headers })
  console.log('File updated, response:', response.data)
  return response.data
}

async function pushFile(
  fileName: string,
  mimeType: string,
  directoryId: string | undefined,
  file: Blob | undefined,
  accessToken: string,
  opts?: {
    appProperties?: Record<string, string>
    properties?: Record<string, string>
  },
) {
  const url = `https://www.googleapis.com/upload/drive/v3/files?${fieldsParam}&uploadType=multipart`

  const metadata: Record<string, unknown> = {
    name: fileName,
    mimeType,
    ...(directoryId ? { parents: [directoryId] } : {}),
    ...(opts?.appProperties ? { appProperties: opts.appProperties } : {}),
    ...(opts?.properties ? { properties: opts.properties } : {}),
  }

  const formData = new FormData()
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  if (file) formData.append('file', file)

  const headers = { Authorization: `Bearer ${accessToken}` }
  const response = await axios.post<gDriveFile>(url, formData, { headers })
  return response.data
}

async function ensureDirectoryExists(
  directoryPath: string,
  accessToken: string,
): Promise<string | null> {
  console.log('ensure dir exists')
  // Search for the directory
  let directoryId = await findFileOrDirectoryId({
    accessToken,
    directory: directoryPath,
  })

  // If directory is not found, create it
  if (!directoryId) {
    directoryId = await createDirectory(directoryPath, accessToken)
  }

  return directoryId
}

export async function findFilesByHash(folderId: string, hash: string, accessToken: string) {
  const q =
    `'${folderId}' in parents and trashed = false and ` +
    `(` +
    `appProperties has { key='h:${hash}' and value='1' } or ` +
    `properties has { key='h:${hash}' and value='1' }` +
    `)`

  const params = {
    q,
    pageSize: 10,
    orderBy: 'createdTime desc',
    fields: 'files(id,name,appProperties,properties,createdTime)',
  }
  const headers = { Authorization: `Bearer ${accessToken}` }
  const { data } = await axios.get('https://www.googleapis.com/drive/v3/files', { headers, params })
  return data.files as Array<{
    id: string
    name: string
    appProperties?: unknown
    properties?: unknown
  }>
}

async function gdrivefindFileOrDirectoryId({
  accessToken,
  fileName,
  directory,
}: {
  accessToken: string
  fileName?: string
  directory?: string
}): Promise<null | string> {
  console.log('Get file or directory ID')

  // Determine the query based on input
  let url
  if (directory && !fileName) {
    // Only directory is given
    url = `https://www.googleapis.com/drive/v3/files?q=name='${directory}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  } else if (fileName && !directory) {
    // Only file is given
    url = `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and mimeType!='application/vnd.google-apps.folder' and trashed=false`
  } else if (fileName && directory) {
    // Both file and directory are given, find the directory ID first
    const directoryId = await gdrivefindFileOrDirectoryId({
      directory,
      accessToken,
    })
    if (!directoryId) {
      throw new Error('Directory not found')
    }
    url = `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and parents in '${directoryId}' and trashed=false`
  } else {
    // Neither file nor directory is given
    throw new Error('No file or directory specified')
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
  }

  const response = await axios.get<{ files: gDriveFile[] }>(url, {
    headers,
  })
  if (response.data.files[0] && response.data.files.length > 0) {
    return response.data.files[0].id // Assuming the first found item is the one we want
  } else {
    return null
  }
}

const findFileOrDirectoryId = asyncLruCache(10)(gdrivefindFileOrDirectoryId)

/**
 * Check out this link here for all options:  https://developers.google.com/drive/api/reference/rest/v3/permissions?authuser=2
 *
 * @param fileId
 * @param accessToken
 * @returns
 */
async function makeFilePublic(fileId: string, accessToken: string) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`
  const permission = {
    role: 'reader',
    /*
    user
    group
    domain
    anyone
    */
    type: 'anyone',
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }

  const response = await axios.post(url, permission, { headers })
  console.log('File made public.')
  return response.data
}

async function createDirectory(directoryPath: string, accessToken: string) {
  console.log('create directory using pushFile method')
  const directoryMimeType = 'application/vnd.google-apps.folder'

  // Call pushFile to create the directory
  const directoryInfo = await pushFile(
    directoryPath,
    directoryMimeType,
    undefined, // No parent directory ID as we are creating a new directory
    undefined,
    accessToken,
  )

  // Return the ID of the newly created directory
  return directoryInfo ? directoryInfo.id : null
}

async function downloadFileFromDrive(fileId: string, accessToken: string) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  }
  const response = await axios.get(url, { headers, responseType: 'blob' })
  console.log('File downloaded successfully.')
  return response.data as File // The file data
}

export function getFileId(originalLink: string) {
  const url = new URL(originalLink)
  const pathParts = url.pathname.split('/')
  const fileId = pathParts[pathParts.length - 2]
  if (!fileId) {
    throw new Error('Invalid Google Drive link')
  }
  return fileId
}

export function gdriveDirectDownloadLink(gdriveLink: string) {
  if (gdriveLink) {
    const fileId = getFileId(gdriveLink)
    return `https://drive.google.com/uc?id=${fileId}&export=download`
  } else {
    throw Error('not able to create direct gdrive download link.')
  }
}
