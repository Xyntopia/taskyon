/**
 * This file contains functions to deal with gdrive synchronization
 * Docs: https://developers.google.com/drive/api/reference/rest/v3
 */

import axios from 'axios'
import { asyncLruCache } from 'src/modules/utils'
import { getOrAuthenticateWithPopup, OAUTH_PROVIDERS } from './oauth'

type gDriveFile = {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
}

// --- constants ---
const MAX_APP_PROPS = 30
const MAX_PUB_PROPS = 30
export const MAX_TOTAL_PROPS = MAX_APP_PROPS + MAX_PUB_PROPS
// choose a safe prefix for metadata
const PROP_PREFIX = 'f.'
// optional: assert the filename itself is Drive-key safe

const DRIVE_KEY_SAFE = /^[A-Za-z0-9.!@$%^&*()_/ -]+$/

function assertDriveKeySafeFilename(name: string) {
  if (!DRIVE_KEY_SAFE.test(name)) {
    throw new Error(`Filename contains invalid chars for Drive: ${name}`)
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

// --- authentication ---
async function getValidAccessToken(signal?: AbortSignal) {
  const creds = await getOrAuthenticateWithPopup(
    'google',
    {
      oauthURL: OAUTH_PROVIDERS.google.authUrl,
      clientId: OAUTH_PROVIDERS.google.clientId,
      scope: OAUTH_PROVIDERS.google.scope,
    },
    signal,
  )
  return creds.access_token
}

// --- unified ID resolver ---
export const resolveDriveId = asyncLruCache(200, [2])(async (
  path: string[],
  type: 'file' | 'directory',
  accessToken: string,
): Promise<string | null> => {
  let parentId = 'root'

  for (let i = 0; i < path.length; i++) {
    const name = path[i]!
    const isLast = i === path.length - 1
    const mimeFilter = isLast
      ? type === 'directory'
        ? "mimeType = 'application/vnd.google-apps.folder'"
        : "mimeType != 'application/vnd.google-apps.folder'"
      : "mimeType = 'application/vnd.google-apps.folder'"

    const q = `name = '${name.replaceAll("'", "\\'")}' and ${mimeFilter} and '${parentId}' in parents and trashed = false`

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )

    if (!res.ok) throw new Error(`Drive API error: ${await res.text()}`)
    const data = await res.json()
    if (!data.files || data.files.length === 0) return null

    parentId = data.files[0].id
  }

  return parentId
})

// mkdir -p helper; invalidates cache when creating
export async function ensurePathId(path: string[], accessToken: string): Promise<string> {
  let parentId = 'root'

  for (let i = 0; i < path.length; i++) {
    const currentPath = path.slice(0, i + 1) // full path up to current segment
    let dirId = await resolveDriveId(currentPath, 'directory', accessToken)
    if (!dirId) {
      // create folder
      const res = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: path[i],
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        }),
      })
      if (!res.ok) throw new Error(`mkdir failed: ${await res.text()}`)
      const data = await res.json()
      dirId = data.id

      // invalidate cache for this full path
      resolveDriveId.invalidate(currentPath, 'directory', accessToken)
    }

    if (!dirId) throw new Error(`Failed to create/find directory: ${path.join('/')}`)
    parentId = dirId
  }

  return parentId
}

// ergonomic wrapper
async function resolveId(opts: {
  accessToken: string
  directory?: string
  fileName?: string
  create?: boolean
}) {
  const { directory, fileName, create = false, accessToken } = opts
  if (directory && create) return ensurePathId(directory.split('/').filter(Boolean), accessToken)
  if (directory && !fileName)
    return resolveDriveId(directory.split('/').filter(Boolean), 'directory', accessToken)
  if (directory && fileName)
    return resolveDriveId([...directory.split('/').filter(Boolean), fileName], 'file', accessToken)
  throw new Error('Invalid resolveId call')
}

// --- main API ---
export const useGdrive = () => {
  async function saveFileToGdrive(file: File, directory: string, share = false) {
    const token = await getValidAccessToken()
    const gdriveFile = await uploadFileToDrive(file, directory, token)
    if (share) {
      await makeFilePublic(gdriveFile.id, token)
      return getFileMetaData(gdriveFile.id, token)
    }
    return gdriveFile
  }

  const publishMarkdown = (content: string, dir: string, fn: string, share = false) =>
    saveFileToGdrive(new File([content], fn, { type: 'text/markdown; charset=UTF-8' }), dir, share)

  const saveObjToGdrive = (obj: Record<string, unknown>, dir: string, fn: string) =>
    saveFileToGdrive(new File([JSON.stringify(obj)], fn, { type: 'application/json' }), dir)

  async function loadFileFromGdrive(directory: string, fileName: string) {
    const token = await getValidAccessToken()
    const fileId = await resolveId({ accessToken: token, directory, fileName })
    if (!fileId) throw new Error('File not found in GDrive.')
    return downloadFileFromDrive(fileId, token)
  }

  async function loadObjFromGdrive(dir: string, fn: string) {
    const blob = await loadFileFromGdrive(dir, fn)
    return JSON.parse(await blob.text())
  }

  async function uploadFileArchiveWMeta(
    directory: string,
    zipFile: File,
    filenames: string[],
    share = false,
  ) {
    const token = await getValidAccessToken()
    const directoryId = await resolveId({ accessToken: token, directory, create: true })
    if (!directoryId) throw new Error('Failed to create/find directory')
    const { appProps, pubProps } = buildNameProps(filenames)
    const fileRec = await pushFile(directoryId, zipFile, token, {
      appProperties: appProps,
      properties: pubProps,
    })
    if (share) {
      await makeFilePublic(fileRec.id, token)
      return getFileMetaData(fileRec.id, token)
    }
    return fileRec
  }

  async function downloadArchiveFile(directory: string, archivedFilename: string) {
    const token = await getValidAccessToken()
    const directoryId = await resolveId({ accessToken: token, directory })
    if (!directoryId) throw new Error(`Directory "${directory}" not found`)
    assertDriveKeySafeFilename(archivedFilename)
    const key = `${PROP_PREFIX}${archivedFilename}`
    const q =
      `'${directoryId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder' and (` +
      `appProperties has { key='${key}' and value='1' } or properties has { key='${key}' and value='1' })`
    const { data } = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        q,
        pageSize: 1,
        orderBy: 'createdTime desc',
        fields: 'files(id,name,createdTime,mimeType)',
      },
    })
    const hit = data.files?.[0]
    if (!hit) return null
    const blob = await downloadFileFromDrive(hit.id, token)
    return new File([blob], hit.name, { type: hit.mimeType })
  }

  return {
    saveObjToGdrive,
    loadObjFromGdrive,
    saveFileToGdrive,
    loadFileFromGdrive,
    publishMarkdown,
    uploadFileArchiveWMeta,
    downloadArchiveFile,
  }
}

// --- low-level ops ---
async function getFileMetaData(fileId: string, token: string) {
  const { data } = await axios.get<gDriveFile>(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink,id,name,mimeType`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return data
}

async function uploadFileToDrive(file: File, directory: string, token: string) {
  const directoryId = await resolveId({ accessToken: token, directory, create: true })
  if (!directoryId) throw new Error('Error in creating or finding directory.')
  const existingFileId = await resolveId({ accessToken: token, directory, fileName: file.name })
  return existingFileId
    ? updateFile(existingFileId, file, token)
    : pushFile(directoryId, file, token)
}

const fieldsParam = 'fields=webViewLink,id,name,mimeType'

async function updateFile(fileId: string, file: File, token: string) {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?${fieldsParam}&uploadType=multipart`
  const metadata = { mimeType: file.type }
  const formData = new FormData()
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  formData.append('file', file)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/related' }
  const { data } = await axios.patch<gDriveFile>(url, formData, { headers })
  return data
}

async function pushFile(
  directoryId: string,
  file: File | { foldername: string },
  token: string,
  opts?: { appProperties?: Record<string, string>; properties?: Record<string, string> },
) {
  const url = `https://www.googleapis.com/upload/drive/v3/files?${fieldsParam}&uploadType=multipart`
  const metadata: Record<string, unknown> = {
    name: 'foldername' in file ? file.foldername : file.name,
    mimeType: 'foldername' in file ? 'application/vnd.google-apps.folder' : file.type,
    parents: [directoryId],
    ...(opts?.appProperties ? { appProperties: opts.appProperties } : {}),
    ...(opts?.properties ? { properties: opts.properties } : {}),
  }
  const formData = new FormData()
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  if (file instanceof File) formData.append('file', file)
  const headers = { Authorization: `Bearer ${token}` }
  const { data } = await axios.post<gDriveFile>(url, formData, { headers })
  return data
}

async function makeFilePublic(fileId: string, token: string) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`
  const permission = { role: 'reader', type: 'anyone' }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const { data } = await axios.post(url, permission, { headers })
  return data
}

async function downloadFileFromDrive(fileId: string, token: string) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  const headers = { Authorization: `Bearer ${token}` }
  const { data } = await axios.get(url, { headers, responseType: 'blob' })
  return data
}

export function getFileId(originalLink: string) {
  const url = new URL(originalLink)
  const parts = url.pathname.split('/')
  const fileId = parts[parts.length - 2]
  if (!fileId) throw new Error('Invalid Google Drive link')
  return fileId
}

export function gdriveDirectDownloadLink(link: string) {
  const fileId = getFileId(link)
  return `https://drive.google.com/uc?id=${fileId}&export=download`
}
