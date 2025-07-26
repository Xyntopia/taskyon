<template>
  <q-layout>
    <q-page-container>
      <q-page padding>
        <!-- Dropzone to upload new files into OPFS -->
        <div class="q-mb-lg">
          <FileDropzone class="fit" enable-paste @add-files="addFiles" />
        </div>
        <!-- List existing files in the browser's Origin Private File System -->
        <q-card>
          <q-card-section>
            <div class="text-h6">Files in Taskyon OPFS</div>
            <div class="text-subtitle2 q-mt-xs">
              The files listed below are currently stored in your browser's persistent storage.
            </div>
          </q-card-section>
          <q-separator />
          <q-card-section>
            <q-list bordered>
              <q-item v-for="file in files" :key="file.name" clickable @click="openFile(file)">
                <q-item-section avatar>
                  <q-icon
                    :name="file.kind === 'directory' ? matFolder : matFilePresent"
                    color="primary"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ file.name }}</q-item-label>
                  <q-item-label v-if="file.size !== undefined" caption>{{
                    formatSize(file.size)
                  }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-item v-if="files.length === 0">
                <q-item-section>
                  <q-item-label>No files found in OPFS.</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import FileDropzone from 'src/components/FileDropzone.vue'
import { matFilePresent, matFolder } from '@quasar/extras/material-icons'

interface FileEntry {
  name: string
  kind: 'file' | 'directory'
  size?: number
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
}

// List of file entries currently stored in OPFS
const files = ref<FileEntry[]>([])

/**
 * Load the list of files/directories stored in the browser's Origin Private File System.
 * This uses the File System Access API (navigator.storage.getDirectory) to iterate over
 * all entries in the root directory and gather basic metadata like size.
 */
async function loadFiles() {
  try {
    const root = await navigator.storage.getDirectory()
    const list: FileEntry[] = []
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === 'file') {
        const file = await handle.getFile()
        list.push({ name, kind: 'file', size: file.size, handle })
      } else {
        // directory handles do not expose a size
        list.push({ name, kind: 'directory', handle })
      }
    }
    files.value = list
  } catch (err) {
    console.error('Failed to load files from OPFS:', err)
    files.value = []
  }
}

/**
 * Add uploaded files to the OPFS.
 * When a user drops or pastes files into the FileDropzone component, this function
 * saves them into the root directory of the Origin Private File System and then
 * refreshes the list.
 */
async function addFiles(fs: File[]) {
  try {
    const root = await navigator.storage.getDirectory()
    for (const file of fs) {
      // create or overwrite the file in OPFS
      const fileHandle = await root.getFileHandle(file.name, { create: true })
      // createWritable may not be typed in some environments
      const writable = await fileHandle.createWritable()
      // Pipe the File stream into the writable stream
      await file.stream().pipeTo(writable)
    }
    await loadFiles()
  } catch (err) {
    console.error('Failed to save files to OPFS:', err)
  }
}

/**
 * Format file sizes for display.
 */
function formatSize(size: number) {
  if (!size) return ''
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(2)} MB`
  } else if (size >= 1024) {
    return `${(size / 1024).toFixed(2)} KB`
  }
  return `${size} B`
}

/**
 * When a file entry is clicked, optionally load and display its contents.
 * Currently this just reads the file and logs it to the console; this can be extended
 * to show a modal or download the file if needed.
 */
async function openFile(file: FileEntry) {
  if (file.kind === 'file') {
    try {
      const fileObj = await (file.handle as FileSystemFileHandle).getFile()
      const text = await fileObj.text()
      console.log(`Contents of ${file.name}:`, text)
    } catch (err) {
      console.error(`Failed to read file ${file.name}`, err)
    }
  } else {
    // Directory browsing could be implemented here in the future
  }
}

onMounted(() => {
  // Populate the list of stored files when the page mounts
  void loadFiles()
})
</script>
