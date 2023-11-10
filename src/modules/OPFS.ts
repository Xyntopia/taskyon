export async function write(file: File) {
  await writeFiles([file]);
}

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

export async function writeFiles(newFiles: File[]) {
  console.log('save file', newFiles);
  if (!newFiles.length) return;

  // Open the "root" of the website's (origin's) private filesystem (OPFS):
  const storageRoot = await getRoot();

  if (storageRoot) {
    // Save each file to the file system.
    for (const file of newFiles) {
      // Create an empty (zero-byte) file in a new subdirectory: "art/mywaifu.png":
      const newSubDir = await storageRoot.getDirectoryHandle('fileuploads', {
        create: true,
      });
      const newFile = await newSubDir.getFileHandle(file.name, {
        create: true,
      });

      // Open the `mywaifu.png` file as a writable stream ( FileSystemWritableFileStream ):
      const wtr = await newFile.createWritable();
      try {
        // Then write the Blob object directly:
        await wtr.write(await file.arrayBuffer());
      } finally {
        // And safely close the file stream writer:
        await wtr.close();
      }
    }
  }
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
  const storageRoot = await getRoot();
  if (storageRoot) {
    // Get the file handle:
    const fileHandle = await storageRoot.getFileHandle(fileName);
    // Get the file object:
    const file = await fileHandle.getFile();
    return file;
  }
}
