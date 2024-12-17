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

type gDriveFile = {
  kind: string //"drive#file",
  id: string //"1G4SJ8bBP13mNRWp9CIzeYNKsjc_q8BHP",
  name: string //"taskyon/templates.json",
  mimeType: string //"application/json"
  webViewLink?: string // optionally a pulic link of the file
}

export const useGdrive = () => {
  const maxTokenAgeMinutes = 55
  const tyGdAccessStorageName = 'tygd'
  const savedToken = String(LocalStorage.getItem(tyGdAccessStorageName))
  const gdriveAccessToken = ref<string>(savedToken) // Store the access token
  watch(
    () => gdriveAccessToken,
    (p, n) => {
      LocalStorage.set(tyGdAccessStorageName, n)
    },
  )

  const tokenReceivedTime = ref(0) // Unix timestamp of when the token was received
  const clientId = '14927198496-jaadcashh91s9gue7uicf3datk79tohc.apps.googleusercontent.com'
  const scope = 'https://www.googleapis.com/auth/drive.file'

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

  return {
    saveObjToGdrive,
    loadObjFromGdrive,
    saveFileToGdrive,
    publishMarkdown,
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
  formData.append('file', new Blob([file], { type: mimeType }))

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
) {
  const url = `https://www.googleapis.com/upload/drive/v3/files?${fieldsParam}&uploadType=multipart`
  // Now, modify the metadata to include the parent directory
  const metadata: Record<string, unknown> = {
    name: fileName,
    mimeType: mimeType,
  }

  if (directoryId) {
    metadata.parents = [directoryId] // Set the parent directory
  }

  const formData = new FormData()
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  if (file) {
    formData.append('file', new Blob([file], { type: mimeType }))
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'multipart/related',
  }

  let uploadedfileData: gDriveFile | undefined = undefined
  const response = await axios.post<gDriveFile>(url, formData, { headers })
  uploadedfileData = response.data
  console.log('File uploaded, response:', response)

  return uploadedfileData
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
