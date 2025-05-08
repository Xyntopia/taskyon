<template>
  <q-input
    v-model.trim="content"
    autogrow
    filled
    color="secondary"
    label="Type your message or instruction..."
    clearable
    input-style="max-height: 300px"
    v-bind="$attrs"
    @keyup="checkKeyboardEvents"
  >
    <template #append>
      <q-btn flat dense round :icon="matSend" @click="$emit('execute-task')">
        <q-tooltip>
          Press to send or alternatively send with &lt;shift&gt; + &lt;enter&gt;
        </q-tooltip>
      </q-btn>
    </template>
    <template #before>
      <FileDropzone
        class="fit"
        accept="*"
        enable-paste
        @add-files="(files) => emit('attach-files', files)"
      >
        <q-btn dense class="fit" flat>
          <q-icon class="gt-xs" :name="matImage" />
          <q-icon :name="matAttachment" />
          <q-tooltip>Attach file or image to message</q-tooltip>
        </q-btn>
      </FileDropzone>
    </template>
  </q-input>
</template>

<script setup lang="ts">
import { matAttachment, matImage, matSend } from '@quasar/extras/material-icons'
import FileDropzone from '../FileDropzone.vue'

const content = defineModel<string | null | undefined>({
  required: true,
})

const props = defineProps<{
  useEnterToSend: boolean
}>()

const emit = defineEmits<{
  (e: 'attach-files', newFiles: File[]): void
  (e: 'execute-task'): void
}>()

const checkKeyboardEvents = (event: KeyboardEvent) => {
  if (props.useEnterToSend) {
    if (!event.shiftKey && event.key === 'Enter') {
      emit('execute-task')
      // Prevent a new line from being added to the input (optional)
      event.preventDefault()
    }
    // otherwise it'll simply be the default action and inserting a newline :)
  } else {
    if (event.shiftKey && event.key === 'Enter') {
      emit('execute-task')
      // Prevent a new line from being added to the input (optional)
      event.preventDefault()
    }
    // otherwise it'll simply be the default action and inserting a newline :)
  }
}
</script>
