<template>
  <div
    :class="['dropzone', disableDropzoneBorder ? '' : 'dashedborder']"
    @dragover.prevent
    @dragenter.prevent
    @drop="handleDrop"
    @click.stop="openFileInput"
  >
    <input
      v-if="!noButtons"
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
      </div>
    </slot>
    <!-- Parent-overlay drop target -->
    <teleport v-if="dropZoneTarget" defer :to="dropZoneTarget">
      <div
        class="drop-overlay"
        @dragover.prevent="handleDragOver"
        @drop.prevent="handleDrop"
        @dragenter.prevent
      />
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { matAddAPhoto, matUploadFile } from '@quasar/extras/material-icons'
import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

const emit = defineEmits(['update:modelValue'])

const props = defineProps({
  accept: { type: String, default: 'image/*,text/*,.pdf,application/*' },
  label: { type: String, default: '' },
  progress: { type: Number, default: 0 },
  disableDropzoneBorder: { type: Boolean, default: false },
  enablePaste: { type: Boolean, default: false },
  dropZoneTarget: { type: String },
  noButtons: { type: Boolean, default: false },
})

const fileInput: Ref<null | HTMLInputElement> = ref(null)

const handleDrop = (e: DragEvent) => {
  e.preventDefault()
  if (e.dataTransfer) {
    handleFiles(e.dataTransfer.files)
  }
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
  emit('update:modelValue', fileList)
}

const openFileInput = () => {
  fileInput.value?.click()
}

onMounted(() => {
  if (props.enablePaste) document.addEventListener('paste', handlePaste)
  // TODO: move
  if (props.dropZoneTarget) {
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('paste', handlePaste)
  window.removeEventListener('dragover', handleDragOver)
  window.removeEventListener('drop', handleDrop)
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
  background: transparent
  pointer-events: all
</style>
