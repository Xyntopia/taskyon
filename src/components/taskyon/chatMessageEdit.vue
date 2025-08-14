<template>
  <div class="chat-wrap rounded-borders">
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
    <div class="chat-toolbars column justify-between border-radius-inherit">
      <div class="bar top border-radius-inherit">
        <slot name="top" />
      </div>
      <div class="col"></div>
      <div class="bar bottom border-radius-inherit q-ml-md">
        <slot name="bottom">
          <q-btn flat :icon="matSend" @click="$emit('execute-task')">
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

<style lang="sass">
.chat-wrap
  position: relative


/* Floating toolbar in the top-right corner */
.chat-toolbars
  position: absolute
  top: 0
  bottom: 0
  right: 0

  // so it doesn't block input */
  pointer-events: none
  /*padding: 4px;*/


.chat-toolbars > div.bar
  background-color: rgba(white, 0.5)
  opacity: 1
  backdrop-filter: blur(1px)
  // Safari support
  -webkit-backdrop-filter: blur(6px)

.body--dark .chat-toolbars > div.bar
  background-color: rgba($dark, 0.5)

.chat-toolbars > *
  /* restore click for inner elements */
  pointer-events: auto


/* Optional: only show when focused or has content */
/*.chat-toolbars {
  opacity: 0.5;
  transition: opacity 0.15s ease;
  }

/*.chat-wrap:focus-within .chat-toolbars
  opacity: 1
</style>
