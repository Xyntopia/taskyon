<template>
  <div class="fit dropzone inset-shadow-down column justify-center" @dragover.prevent @dragenter.prevent
    @drop="handleDrop" @click="openFileInput">
    <div>
      <p>{{ label }}</p>
    </div>
    <div>
      <input class="hidden" type="file" multiple @change="handleFileInput" ref="fileInput" />
    </div>
    <div>
      <q-btn v-if="progress == 0" icon="add" flat @click="openFileInput" />
      <q-circular-progress v-else :value="progress*100" color="secondary" class="q-md-sm" size="xl" show-value>{{ progress*100
      }}%</q-circular-progress>
    </div>
  </div>
</template>

<style lang="sass">
.dropzone
  border: 2px dashed $secondary
  border-radius: 5px
  text-align: center
  cursor: pointer
</style>

<script lang="ts">
import { defineComponent, ref, Ref } from 'vue'

export default defineComponent({
  emits: ['update:modelValue'],
  name: 'DropZone',
  props: {
    label: {
      type: String,
      default: ''
    },
    progress: {
      type: Number,
      default: 0
    }
  },
  setup(props, { emit }) {
    const fileInput: Ref<null | HTMLInputElement> = ref(null);

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        handleFiles(e.dataTransfer.files);
      }
    };

    const handleFileInput = (e: Event) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) {
        handleFiles(files);
      }
    };

    const handleFiles = (files: FileList) => {
      const fileList = Array.from(files);
      emit('update:modelValue', fileList);
    };

    const openFileInput = () => {
      if (fileInput.value) {
        fileInput.value.click();
      }
    };

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

    return {
      fileInput,
      handleDrop,
      handleFileInput,
      handleFiles,
      openFileInput,
    };
  },
})
</script>
