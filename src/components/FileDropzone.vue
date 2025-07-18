<template>
  <!-- hidden inputs -->
  <input
    ref="cameraInput"
    type="file"
    accept="image/*"
    capture="environment"
    class="hidden"
    @change="onInputChange"
  />
  <input
    ref="fileInput"
    type="file"
    :accept="accept"
    multiple
    class="hidden"
    @change="onInputChange"
  />
  <input
    ref="dirInput"
    type="file"
    webkitdirectory
    directory
    class="hidden"
    @change="onInputChange"
  />
  <div
    v-if="!noButtons"
    :class="['dropzone', disableDropzoneBorder ? '' : 'dashedborder']"
    v-bind="$attrs"
    @dragover.prevent
    @dragenter.prevent
    @drop="onDrop"
    @click.stop="onDropzoneClick"
  >
    <slot v-if="!noButtons">
      <div class="fit column justify-center">
        <div>
          <p>{{ label }}</p>
        </div>
        <div>
          <q-btn v-if="progress === 0" flat>
            <div class="row">
              <q-icon :name="matUploadFile" />
              <q-icon :name="matAddAPhoto" />
            </div>
          </q-btn>
          <q-circular-progress v-else :value="progress * 100" class="q-md-sm" size="xl" show-value>
            {{ Math.round(progress * 100) }}%
          </q-circular-progress>
        </div>
      </div>
    </slot>
    <!-- if we are in electron, we want a choice to scan a directory:  "webkitdirectory", "directory" -->
    <!-- add "capture" attribute in order to accept camera newlyAddedFiles from cellphone-->
    <!--TODO: add the following as an option
      <q-file append class="hidden" multiple ref="filePicker" v-model="newlyAddedFiles"
        accept="image/*,text/*,.pdf,application/*" capture="environment" />
      <div class="row items-stretch q-gutter-x-xs">
        <q-btn class="col-3" color="primary" text-color="white" stack @click="filePicker?.pickFiles()">
          <div clas="row">
            <q-icon :name="matUploadFile" />
            <q-icon :name="matAddAPhoto" />
          </div>
          add file(s)
        </q-btn>
      <div>
        -->
  </div>
  <!-- named slot for full override; fallback is the menu with delegation -->
  <q-menu v-if="enableMenu" ref="menu" auto-close>
    <q-list @click="onDelegate">
      <q-item clickable data-action="camera">
        <q-item-section avatar><q-icon :name="matCameraAlt" /></q-item-section>
        <q-item-section>Take Photo</q-item-section>
      </q-item>
      <q-item clickable data-action="file">
        <q-item-section avatar><q-icon :name="matFileOpen" /></q-item-section>
        <q-item-section>File Manager</q-item-section>
      </q-item>
      <q-item clickable data-action="dir">
        <q-item-section avatar><q-icon :name="matFolderOpen" /></q-item-section>
        <q-item-section>Select Directory</q-item-section>
      </q-item>
      <q-item v-if="enablePaste" clickable data-action="paste">
        <q-item-section avatar><q-icon :name="matContentPaste" /></q-item-section>
        <q-item-section>Paste from Clipboard</q-item-section>
      </q-item>
    </q-list>
  </q-menu>
  <!-- only render overlay when dragging over target, we are using "defer" to make sure, the target exists
     when rendering this component... -->
  <teleport v-if="dropZoneTarget" defer :to="dropZoneTarget">
    <transition name="fade">
      <div
        v-if="isDragging"
        :class="['drop-overlay', 'highlighted', disableDropzoneBorder ? '' : 'dashedborder']"
      >
        <q-icon size="10rem" :name="matUpload" />
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import {
  matAddAPhoto,
  matCameraAlt,
  matContentPaste,
  matFileOpen,
  matFolderOpen,
  matUpload,
  matUploadFile,
} from '@quasar/extras/material-icons'
import { QMenu } from 'quasar'

defineOptions({
  // we need inheritAttrs: false, because we have multiple root elements and explicitly
  // set v-bind="$attrs"
  inheritAttrs: false,
})
const props = defineProps({
  accept: { type: String, default: 'image/*,text/*,.pdf,application/*' },
  label: { type: String, default: '' },
  progress: { type: Number, default: 0 },
  disableDropzoneBorder: { type: Boolean, default: false },
  enablePaste: { type: Boolean, default: false },
  dropZoneTarget: { type: String, default: undefined },
  noButtons: { type: Boolean, default: false },
  enableMenu: { type: Boolean, default: false },
})

const emit = defineEmits<{
  (e: 'add-files', files: File[]): void
}>()

// state + refs
// track “are we currently dragging over the target?”
const isDragging = ref(false)
let targetEl: HTMLElement | null = null
const cameraInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const dirInput = ref<HTMLInputElement | null>(null)
const menu = ref<QMenu>()

function onDropzoneClick(evt: Event) {
  if (!props.enableMenu) fileInput.value?.click()
  else menu.value?.toggle(evt)
}

// drag/drop handlers
function onDragEnter(e: DragEvent) {
  console.log('entering dropzone...')
  e.preventDefault()
  isDragging.value = true
}
function onDragLeave(e: DragEvent) {
  console.log('leaving dropzone...')
  // only turn off when truly leaving the target
  const to = e.relatedTarget as Node | null
  if (!to || !targetEl?.contains(to)) {
    isDragging.value = false
  }
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  if (e.dataTransfer) handleFiles(e.dataTransfer.files)
}

// delegate
function onDelegate(e: MouseEvent) {
  // ensure we work with HTMLElement
  console.log('an attachment event was started!')
  const target = e.target as HTMLElement
  const itm = target.closest<HTMLElement>('[data-action]')
  const action = itm?.dataset.action as 'camera' | 'file' | 'dir' | 'paste' | undefined
  if (!action) return
  switch (action) {
    case 'camera':
      cameraInput.value?.click()
      break
    case 'file':
      fileInput.value?.click()
      break
    case 'dir':
      dirInput.value?.click()
      break
    // we don't need the paste one, because we rely on the paste event handler
  }
}

// file handling
function handleFiles(src: FileList | File[]) {
  const list = Array.from(src instanceof FileList ? src : src)
  if (list.length) emit('add-files', list)
}

// input change wrapper
function onInputChange(e: Event) {
  console.log('something was uploaded!')
  const files = (e.target as HTMLInputElement).files
  if (files) handleFiles(files)
}

// paste listener
const handlePaste = (e: ClipboardEvent) => {
  console.log('paste event occured!! :)', e)
  if (!props.enablePaste) return
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (let i = 0; i < items.length; i++) {
    const f = items[i]!.getAsFile()
    if (f) files.push(f)
  }
  if (files.length) handleFiles(files)
}

// lifecycle
onMounted(() => {
  if (props.dropZoneTarget) {
    targetEl = document.querySelector(props.dropZoneTarget)
    if (targetEl) {
      targetEl.addEventListener('dragenter', onDragEnter)
      targetEl.addEventListener('dragleave', onDragLeave)
      targetEl.addEventListener('dragover', (e) => e.preventDefault())
      targetEl.addEventListener('drop', onDrop)
    } else {
      console.error(`[FileDropzone] Could not find dropZoneTarget element: ${props.dropZoneTarget}`)
    }
  }
  if (props.enablePaste) document.addEventListener('paste', handlePaste)
})
onBeforeUnmount(() => {
  if (targetEl) {
    targetEl.removeEventListener('dragenter', onDragEnter)
    targetEl.removeEventListener('dragleave', onDragLeave)
    targetEl.removeEventListener('drop', onDrop)
  }
  document.removeEventListener('paste', handlePaste)
})

/*
TODO: add native file directory function in case we're using tauri
async function openDir() {
  // Open a selection dialog for directories
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath: await homeDir(),
  });
  if (Array.isArray(selected)) {
    // user selected multiple directories
    return selected[0];
  } else if (selected === null) {
    // user cancelled the selection
    return '';
  } else {
    // user selected a single directory
    return selected;
  }
}*/
</script>

<style lang="sass" scoped>
.dashedborder
  border: 2px dashed
  border-radius: 5px

.dropzone
  position: relative
  text-align: center
  cursor: pointer

.drop-overlay
  position: fixed
  inset: 0
  pointer-events: none
  background-color: rgba(white, 0.4)
  display: flex
  align-items: center
  justify-content: center
  padding: 1rem
  margin: 1rem

.drop-overlay.highlighted
  display: flex
  align-items: center
  justify-content: center
  /* give the icon extra breathing room */
  padding: 1rem

.fade-enter-active,
.fade-leave-active
  transition: opacity 150ms ease
.fade-enter-from,
.fade-leave-to
  opacity: 0
</style>
