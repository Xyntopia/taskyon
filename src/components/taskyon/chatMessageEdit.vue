<template>
  <div class="msg-edit rounded-borders">
    <div>
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
      >
        <template #before>
          <template v-if="smallMode">
            <slot name="left" />
          </template>
        </template>
      </q-input>
      <q-resize-observer @resize="onResize" />
    </div>
    <div v-if="!smallMode" class="toolbar-left border-radius-inherit">
      <div class="bar border-radius-inherit">
        <slot name="left" />
      </div>
    </div>
    <!-- One positioned container that holds both toolbars -->
    <div class="toolbars border-radius-inherit">
      <div class="bar top border-radius-inherit">
        <slot name="top" />
      </div>
      <div class="bar bottom border-radius-inherit">
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
import { computed } from 'vue'
import { ref } from 'vue'

const h = ref(0)
const w = ref(0)
const heightLimit = 60

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

const onResize = ({ height, width }: { height: number; width: number }) => {
  h.value = height
  w.value = width
}

const smallMode = computed(() => {
  return h.value < heightLimit
})
</script>

<style scoped lang="scss">
/* container */
.msg-edit {
  position: relative;
}

.toolbar-left {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;

  pointer-events: none; // don't block typing
}

.toolbars {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;

  pointer-events: none; // don't block typing
}

.toolbars {
  display: flex;
  flex-flow: column wrap;
  align-items: flex-end; /* right-align items in each column */
  align-content: flex-end; /* pack columns to the right when wrapping */
}

.toolbars > .bottom {
  margin-block-start: auto; /* sit at bottom of its column (also in single-column) */
}

.bottom {
  margin-block-start: auto; /* sit at bottom of its column (also in single-column) */
  margin: 0 10px 10px 0;
}

div.bar {
  /* restore clicks for inner controls */
  pointer-events: auto;

  background-color: rgba(white, 0);
  opacity: 1;
  backdrop-filter: blur(1px);
  // Safari support
  -webkit-backdrop-filter: blur(1px);
}

.toolbars > div.bar {
  display: inline-flex; /* size to content; keeps right alignment tidy */
}

.body--dark .toolbars > div.bar {
  background-color: rgba($dark, 0);
}
</style>
