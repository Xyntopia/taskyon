<template>
  <div class="msg-edit rounded-borders">
    <!-- Edit chat messages -->
    <q-input
      v-model.trim="content"
      data-cy="chat-input"
      autogrow
      autofocus
      borderless
      placeholder="Type your message..."
      :input-style="{ maxHeight: '300px' }"
      class="q-px-sm"
      v-bind="$attrs"
      @keyup="checkKeyboardEvents"
    />

    <!-- One positioned container that holds both toolbars -->
    <div class="toolbars border-radius-inherit">
      <div class="bar top border-radius-inherit">
        <slot name="top" />
      </div>
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

<style lang="scss">
/* container */
.msg-edit {
  position: relative;
}

/* floating toolbar column */
.toolbars {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  pointer-events: none; /* don't block typing */
}

/* restore clicks for inner controls */
.toolbars > * {
  pointer-events: auto;
}

.toolbars > div.bar {
  background-color: rgba(white, 0);
  opacity: 1;
  backdrop-filter: blur(1px);
  // Safari support
  -webkit-backdrop-filter: blur(6px);
}

.body--dark .toolbars > div.bar {
  background-color: rgba($dark, 0);
}
</style>
