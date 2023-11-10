export async function attachFile(newFiles: File[]) {
  if (!newFiles.length) return;

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
