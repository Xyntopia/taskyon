<template>
  <div
    :class="'fit dropzone ' + colorClass"
    @dragover.prevent
    @dragenter.prevent
    @drop="handleDrop"
    @click.stop="openFileInput"
  >
    <input
      class="hidden"
      type="file"
      multiple
      @change="handleFileInput"
      ref="fileInput"
      accept="image/*,text/*,.pdf,application/*"
      capture="environment"
      @click.stop
    />

    <slot>
      <div class="fit inset-shadow-down column justify-center">
        <div>
          <p>{{ label }}</p>
        </div>
        <div>
          <q-btn v-if="progress == 0" flat>
            <div clas="row">
              <q-icon name="upload_file" />
              <q-icon name="add_a_photo" />
            </div>
          </q-btn>
          <q-circular-progress
            v-else
            :value="progress * 100"
            color="secondary"
            class="q-md-sm"
            size="xl"
            show-value
            >{{ progress * 100 }}%</q-circular-progress
          >
        </div>
        <!-- if we are in electron, we want a choice to scan a directory:  "webkitdirectory", "directory" -->
        <!-- add "capture" attribute in order to accept camera newlyAddedFiles from cellphone-->
        <!--TODO: add the following as an option
    <q-file append class="hidden" multiple ref="filePicker" v-model="newlyAddedFiles"
        accept="image/*,text/*,.pdf,application/*" capture="environment" />
      <div class="row items-stretch q-gutter-x-xs">
        <q-btn class="col-3" color="primary" text-color="white" stack @click="filePicker?.pickFiles()">
          <div clas="row">
            <q-icon name="upload_file" />
            <q-icon name="add_a_photo" />
          </div>
          add file(s)
        </q-btn>
      <div>
        -->
      </div>
    </slot>
  </div>
</template>

<style lang="sass">
.dashedborder
  border-width: 2px
  border-style: dashed
  border-radius: 5px

.dropzone
  text-align: center
  cursor: pointer
</style>

<script setup lang="ts">
import { ref, Ref, computed } from 'vue';

const emit = defineEmits(['update:modelValue']);

const props = defineProps({
  label: {
    type: String,
    default: '',
  },
  progress: {
    type: Number,
    default: 0,
  },
  color: {
    type: String,
    default: null,
  },
  disableDropzoneBorder: {
    type: Boolean,
    default: false,
  },
});

const colorClass = computed(() => {
  if (props.disableDropzoneBorder != true) {
    return 'dashedborder text-' + props.color;
  } else {
    return '';
  }
});

//name: 'DropZone',
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

const openFileInput = (/*event: Event*/) => {
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
</script>
