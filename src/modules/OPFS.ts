async function getRoot() {
  // Open the "root" of the website's (origin's) private filesystem (OPFS):
  let storageRoot: FileSystemDirectoryHandle | undefined = undefined;
  try {
    if (navigator.storage && navigator.storage.getDirectory) {
      storageRoot = await navigator.storage.getDirectory();
    }
  } catch (err) {
    console.error(err);
    return;
  }
  return storageRoot;
}

export async function writeFilesToOpfs(
  newFiles: File[] // string is an id e.g. the uuid of our file!
): Promise<{ [key: number]: string }> {
  console.log('save file to OPFS', newFiles);
  if (!newFiles.length) return {};

  const storageRoot = await getRoot();
  const filenameMapping: { [key: string]: string } = {};

  if (storageRoot) {
    for (const [fileId, file] of newFiles.entries()) {
      const newSubDir = await storageRoot.getDirectoryHandle('fileuploads', {
        create: true,
      });

      let newFileName = file.name;
      let fileExists = await checkFileExists(newSubDir, newFileName);
      let counter = 1;

      while (fileExists) {
        newFileName = addSuffixToFile(file.name, counter);
        fileExists = await checkFileExists(newSubDir, newFileName);
        counter++;
      }

      const newFile = await newSubDir.getFileHandle(newFileName, {
        create: true,
      });

      const wtr = await newFile.createWritable();
      try {
        await wtr.write(await file.arrayBuffer());
        filenameMapping[fileId] = newFileName; // Map the original filename to the new filename
      } finally {
        await wtr.close();
      }
    }
  }

  return filenameMapping; // Return the mapping object
}

async function checkFileExists(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<boolean> {
  try {
    await directoryHandle.getFileHandle(fileName);
    return true;
  } catch (e) {
    if (e instanceof Error && e.name === 'NotFoundError') {
      return false;
    }
    throw e;
  }
}

function addSuffixToFile(fileName: string, suffix: number): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) {
    return `${fileName}-${suffix}`;
  }
  return `${fileName.substring(0, dotIndex)}-${suffix}${fileName.substring(
    dotIndex
  )}`;
}

export async function ls(dir: string) {
  const storageRoot = await getRoot();
  if (storageRoot) {
    const dirHandle = await storageRoot.getDirectoryHandle(dir);
    const files = [];
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file') {
        files.push(name);
      }
    }
    return files;
  }
}

export async function openFile(fileName: string) {
  console.log('opening file: ', fileName);
  try {
    const storageRoot = await getRoot();
    if (storageRoot) {
      // Get the file handle:
      const dirHandle = await storageRoot.getDirectoryHandle('fileuploads');
      const fileHandle = await dirHandle.getFileHandle(fileName);
      // Get the file object:
      const file = await fileHandle.getFile();
      return file;
    }
  } catch (err) {
    console.error(err);
    return undefined;
  }
}
