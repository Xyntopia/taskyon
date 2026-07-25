<template>
  <q-list>
    <q-item v-for="file in fileMappings" :key="file.id">
      <!-- Image preview, loaded asynchronously -->
      <q-item-section v-if="preview && previews[file.id] !== '__fallback__'">
        <q-img
          v-if="previews[file.id]"
          :src="previews[file.id]"
          :style="{ width: previewSize + 'px', height: previewSize + 'px' }"
        />
        <q-skeleton v-else :width="previewSize + 'px'" :height="previewSize + 'px'" />
      </q-item-section>

      <q-item-section class="ellipsis">
        {{ file.name || file.opfs }}
      </q-item-section>

      <q-tooltip v-if="expertMode" :delay="500">
        <p class="text-bold">uploaded file:</p>
        <p style="white-space: pre-wrap">
          {{ dump({ uuid: file.id, name: file.name }) }}
        </p>
      </q-tooltip>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { dump } from 'js-yaml'
import { watch } from 'vue'
import type { FileMapping } from '@taskyon/taskyon'

// Store the props in a variable for easy access
const props = defineProps<{
  fileMappings: readonly FileMapping[]
  expertMode: boolean
  preview: boolean
  previewSize: number // New prop for configurable preview size
  getFile: (uuid: string) => Promise<File | undefined>
}>()

const previews = ref<Record<string, string>>({}) // Store object URLs as strings

// Create scaled image with the max size coming from props
const createScaledImage = async (file: File, maxSize = props.previewSize) => {
  return new Promise<string>((resolve) => {
    const img = document.createElement('img')
    img.src = URL.createObjectURL(file)

    img.onload = () => {
      const dpr = window.devicePixelRatio || 1
      const scale = Math.min(maxSize / img.width, maxSize / img.height)

      const canvas = document.createElement('canvas')
      // Increase canvas resolution by devicePixelRatio
      canvas.width = img.width * scale * dpr
      canvas.height = img.height * scale * dpr
      // Keep the displayed size as maxSize (or img.width * scale)
      canvas.style.width = `${img.width * scale}px`
      canvas.style.height = `${img.height * scale}px`

      const ctx = canvas.getContext('2d')
      // Scale the drawing context to counter the increased canvas resolution
      ctx?.scale(dpr, dpr)
      ctx?.drawImage(img, 0, 0, img.width * scale, img.height * scale)
      resolve(canvas.toDataURL())
    }
  })
}

const loadAllPreviews = async () => {
  const previewPromises = props.fileMappings.map(async (file) => {
    if (file?.id) {
      const previewFile = await props.getFile(file.id)
      if (previewFile) {
        // If the file isn’t an image, mark as fallback
        if (!previewFile.type.startsWith('image/')) {
          previews.value[file.id] = '__fallback__'
        } else {
          const scaledPreview = await createScaledImage(previewFile)
          previews.value[file.id] = scaledPreview
        }
      }
    }
  })
  await Promise.all(previewPromises)
}

watch(
  () => props.fileMappings,
  () => {
    void loadAllPreviews()
  },
  {
    immediate: true,
  },
)
</script>
