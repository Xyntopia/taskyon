<template>
  <div>
    <!-- Edit chat messages -->
    <q-input
      v-model.trim="content"
      data-cy="chat-input"
      autogrow
      autofocus
      borderless
      color="secondary"
      placeholder="Type your message..."
      :input-style="{ maxHeight: '300px' }"
      class="chat-input pr-reserved"
      v-bind="$attrs"
      @keyup="checkKeyboardEvents"
    />

    <!-- Overlay toolbar (out of the typing flow) -->
    <div class="chat-toolbar-top">
      <slot name="top">
        <q-btn
          flat
          dense
          round
          :icon="symOutlinedCancel"
          :color="$q.dark.isActive ? 'white' : 'dark'"
          @click="content = ''"
        >
          <q-tooltip>Clear</q-tooltip>
        </q-btn>
      </slot>
    </div>
    <div class="chat-toolbar-bottom">
      <slot name="bottom">
        <q-btn
          flat
          dense
          round
          :icon="matSend"
          :color="$q.dark.isActive ? 'white' : 'dark'"
          @click="$emit('execute-task')"
        >
          <q-tooltip>Send ({{ props.useEnterToSend ? 'Enter' : 'Shift+Enter' }})</q-tooltip>
        </q-btn>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { matSend } from '@quasar/extras/material-icons'
import { symOutlinedCancel } from '@quasar/extras/material-symbols-outlined'

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
.chat-toolbar-top {
  position: absolute;
  top: 6px;
  right: 8px;
  display: flex;
  gap: 6px;
  pointer-events: auto;
}

.chat-toolbar-bottom {
  position: absolute;
  bottom: -6px;
  right: 8px;
  display: flex;
  pointer-events: auto;
}

/* Optional: only show when focused or has content */
/*
.chat-toolbar { opacity: 0.75; transition: opacity .15s ease; }
.chat-wrap:focus-within .chat-toolbar { opacity: 1; }
*/
</style>
