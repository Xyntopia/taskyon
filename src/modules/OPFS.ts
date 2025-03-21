async function getRoot() {
  // Open the "root" of the website's (origin's) private filesystem (OPFS):
  let storageRoot: FileSystemDirectoryHandle | undefined = undefined
  try {
    if (navigator.storage && navigator.storage.getDirectory) {
      storageRoot = await navigator.storage.getDirectory()
    }
  } catch (err) {
    console.error(err)
    return
  }
  return storageRoot
}

const userUploadOpfsDir = 'user_uploads'

export async function saveUserUploadedFileToOpfs(
  newFiles: File[], // string is an id e.g. the uuid of our file!
): Promise<{ [key: number]: string }> {
  console.log('save file to OPFS', newFiles)
  if (!newFiles.length) return {}

  const storageRoot = await getRoot()
  const filenameMapping: { [key: string]: string } = {}

  if (storageRoot) {
    for (const [fileId, file] of newFiles.entries()) {
      const newSubDir = await storageRoot.getDirectoryHandle(userUploadOpfsDir, {
        create: true,
      })

      let newFileName = file.name
      let fileExists = await checkFileExists(newSubDir, newFileName)
      let counter = 1

      while (fileExists) {
        newFileName = addSuffixToFile(file.name, counter)
        fileExists = await checkFileExists(newSubDir, newFileName)
        counter++
      }

      const newFile = await newSubDir.getFileHandle(newFileName, {
        create: true,
      })

      const wtr = await newFile.createWritable()
      try {
        await wtr.write(await file.arrayBuffer())
        filenameMapping[fileId] = `${newSubDir.name}/${newFileName}` // Map the original filename to the new filename
      } finally {
        await wtr.close()
      }
    }
  }

  return filenameMapping // Return the mapping object
}

async function checkFileExists(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<boolean> {
  try {
    await directoryHandle.getFileHandle(fileName)
    return true
  } catch (e) {
    if (e instanceof Error && e.name === 'NotFoundError') {
      return false
    }
    throw e
  }
}

function addSuffixToFile(fileName: string, suffix: number): string {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex === -1) {
    return `${fileName}-${suffix}`
  }
  return `${fileName.substring(0, dotIndex)}-${suffix}${fileName.substring(dotIndex)}`
}

export async function ls(dir: string) {
  const storageRoot = await getRoot()
  if (storageRoot) {
    const dirHandle = await storageRoot.getDirectoryHandle(dir)
    const files = []
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file') {
        files.push(name)
      }
    }
    return files
  }
}

export async function openUserUploadedFile(filePath: string) {
  console.log('opening file: ', filePath)
  try {
    const storageRoot = await getRoot()
    if (storageRoot) {
      const pathParts = filePath.split('/')
      const fileName = pathParts.pop()!
      let dirHandle = storageRoot

      for (const part of pathParts) {
        dirHandle = await dirHandle.getDirectoryHandle(part)
      }

      const fileHandle = await dirHandle.getFileHandle(fileName)
      const file = await fileHandle.getFile()
      return file
    }
  } catch (err) {
    console.error(err)
    return undefined
  }
}
