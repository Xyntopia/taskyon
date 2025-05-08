<template>
  <div
    v-if="!noButtons"
    :class="['dropzone', disableDropzoneBorder ? '' : 'dashedborder']"
    @dragover.prevent
    @dragenter.prevent
    @drop="onDrop"
    @click.stop="openFileInput"
    v-bind="$attrs"
  >
    <input
      ref="fileInput"
      class="hidden"
      type="file"
      multiple
      :accept="accept"
      capture="environment"
      @change="handleFileInput"
      @click.stop
    />
    <slot v-if="!noButtons">
      <div class="fit inset-shadow-down column justify-center">
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
          <q-circular-progress
            v-else
            :value="progress * 100"
            color="secondary"
            class="q-md-sm"
            size="xl"
            show-value
          >
            {{ Math.round(progress * 100) }}%
          </q-circular-progress>
        </div>
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
    </slot>
  </div>
  <!-- only render overlay when dragging over target, we are using "defer" to make sure, the target exists
     when rendering this component... -->
  <teleport v-if="dropZoneTarget" defer :to="dropZoneTarget">
    <transition name="fade">
      <div v-if="isDragging" class="drop-overlay highlighted">
        <q-icon name="add_circle" size="xl" color="green" />
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { matAddAPhoto, matUploadFile } from '@quasar/extras/material-icons'
import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

const emit = defineEmits<{
  (e: 'add-files', newFiles: File[]): void
}>()

const props = defineProps({
  accept: { type: String, default: 'image/*,text/*,.pdf,application/*' },
  label: { type: String, default: '' },
  progress: { type: Number, default: 0 },
  disableDropzoneBorder: { type: Boolean, default: false },
  enablePaste: { type: Boolean, default: false },
  dropZoneTarget: { type: String },
  noButtons: { type: Boolean, default: false },
})

// track “are we currently dragging over the target?”
const isDragging = ref(false)
let targetEl: HTMLElement | null = null
const fileInput: Ref<null | HTMLInputElement> = ref(null)

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

const handleDragOver = (e: DragEvent) => {
  console.log('dragging over dropzone!')
  e.preventDefault()
}

const handlePaste = (e: ClipboardEvent) => {
  console.log('paste event occured!! :)', e)
  const items = e.clipboardData?.items
  if (items) {
    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length) handleFiles(files)
  }
}

const handleFileInput = (e: Event) => {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) handleFiles(files)
}

const handleFiles = (files: FileList | File[]) => {
  const fileList = Array.from(files)
  emit('add-files', fileList)
}

const openFileInput = () => {
  fileInput.value?.click()
}

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
})

onMounted(() => {
  if (props.enablePaste) document.addEventListener('paste', handlePaste)
  // TODO: move
  if (props.dropZoneTarget) {
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', onDrop)
  }
})

onBeforeUnmount(() => {
  if (targetEl) {
    targetEl.removeEventListener('dragenter', onDragEnter)
    targetEl.removeEventListener('dragleave', onDragLeave)
    targetEl.removeEventListener('drop', onDrop)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('paste', handlePaste)
  window.removeEventListener('dragover', handleDragOver)
  window.removeEventListener('drop', onDrop)
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
  border-width: 2px
  border-style: dashed
  border-radius: 5px

.dropzone
  position: relative
  text-align: center
  cursor: pointer

.drop-overlay
  position: absolute
  inset: 0
  pointer-events: none

.drop-overlay.highlighted
  border: 2px dashed green
  display: flex
  align-items: center
  justify-content: center

.fade-enter-active,
.fade-leave-active
  transition: opacity 150ms ease
.fade-enter-from,
.fade-leave-to
  opacity: 0
</style>
