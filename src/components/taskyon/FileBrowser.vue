<template>
  <q-list>
    <q-item v-for="file in fileMappings" :key="file.uuid">
      <!-- Image preview, loaded asynchronously -->
      <q-item-section v-if="preview">
        <q-img
          v-if="previews[file.uuid]"
          :src="previews[file.uuid]"
          :style="{ width: previewSize + 'px', height: previewSize + 'px' }"
        />
        <!-- Show a skeleton loader while the image is being fetched -->
        <q-skeleton
          v-else
          :width="previewSize + 'px'"
          :height="previewSize + 'px'"
        />
      </q-item-section>

      <q-item-section class="ellipsis">
        {{ file.name || file.opfs }}
      </q-item-section>

      <q-tooltip v-if="expertMode" :delay="500">
        <p class="text-bold">uploaded file:</p>
        <p style="white-space: pre-wrap">
          {{ dump({ uuid: file.uuid, name: file.name }) }}
        </p>
      </q-tooltip>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { FileMappingDocType } from 'src/modules/taskyon/rxdb';
import { dump } from 'js-yaml';
import { watch } from 'vue';

// Store the props in a variable for easy access
const props = defineProps<{
  fileMappings: FileMappingDocType[];
  expertMode: boolean;
  preview: boolean;
  previewSize: number; // New prop for configurable preview size
  getFile: (uuid: string) => Promise<File | undefined>;
}>();

const previews = ref<Record<string, string>>({}); // Store object URLs as strings

// Create scaled image with the max size coming from props
const createScaledImage = async (file: File, maxSize = props.previewSize) => {
  return new Promise<string>((resolve) => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(maxSize / img.width, maxSize / img.height);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL());
    };
  });
};

const loadAllPreviews = async () => {
  const previewPromises = props.fileMappings.map(async (file) => {
    if (file?.uuid) {
      const previewFile = await props.getFile(file.uuid);
      if (previewFile) {
        const scaledPreview = await createScaledImage(previewFile);
        previews.value[file.uuid] = scaledPreview;
      }
    }
  });
  await Promise.all(previewPromises);
};

watch(
  () => props.fileMappings,
  () => {
    loadAllPreviews();
  },
  {
    immediate: true,
  },
);
</script>
