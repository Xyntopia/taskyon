<template>
  <div class="chat-wrap">
    <!-- Edit chat messages -->
    <q-input
      v-model.trim="content"
      data-cy="chat-input"
      autogrow
      autofocus
      borderless
      placeholder="Type your message..."
      :input-style="{ maxHeight: '300px' }"
      class="q-px-xs"
      v-bind="$attrs"
      @keyup="checkKeyboardEvents"
    />

    <!-- One positioned container that holds both toolbars -->
    <div class="chat-toolbars column justify-between">
      <div class="chat-toolbar-top">
        <slot name="top" />
      </div>
      <div class="chat-toolbar-bottom">
        <slot name="bottom">
          <q-btn flat dense round :icon="matSend" @click="$emit('execute-task')">
            <q-tooltip>Send ({{ props.useEnterToSend ? 'Enter' : 'Shift+Enter' }})</q-tooltip>
          </q-btn>
        </slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { matSend } from '@quasar/extras/material-icons'

const content = defineModel<string | null | undefined>({
  required: true,
})

const props = defineProps<{
  useEnterToSend: boolean
}>()

const emit = defineEmits<{
  (e: 'execute-task'): void
}>()

const checkKeyboardEvents = (event: KeyboardEvent) => {
  if (props.useEnterToSend) {
    if (!event.shiftKey && event.key === 'Enter') {
      emit('execute-task')
      event.preventDefault()
    }
  } else {
    if (event.shiftKey && event.key === 'Enter') {
      emit('execute-task')
      event.preventDefault()
    }
  }
}
</script>

<style scoped>
.chat-wrap {
  position: relative;
}

/* Floating toolbar in the top-right corner */
.chat-toolbars {
  position: absolute;
  top: 8px;
  bottom: 0;
  right: 8px;
}

/* Optional: only show when focused or has content */
/*
.chat-toolbar { opacity: 0.75; transition: opacity .15s ease; }
.chat-wrap:focus-within .chat-toolbar { opacity: 1; }
*/
</style>
