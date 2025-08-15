<template>
  <div class="msg-edit rounded-borders">
    <!--{{ smallMode }} {{ h }}-->
    <div>
      <!-- Edit chat messages -->
      <q-input
        v-if="smallMode"
        v-model="content"
        data-cy="chat-input"
        autogrow
        autofocus
        borderless
        placeholder="Type your message..."
        :input-style="{ maxHeight: '300px' }"
        :class="['q-px-sm', content?.length ? 'q-pt-sm' : '']"
        v-bind="$attrs"
        @keyup="checkKeyboardEvents"
      >
        <template #before>
          <slot name="left" btn-size="md" />
        </template>
        <template #after>
          <slot name="bottom" btn-size="md">
            <q-btn flat :icon="matSend" @click="$emit('execute-task')">
              <q-tooltip>Send ({{ props.useEnterToSend ? 'Enter' : 'Shift+Enter' }})</q-tooltip>
            </q-btn>
          </slot>
        </template> </q-input
      ><q-input
        v-else
        v-model="content"
        autogrow
        autofocus
        borderless
        placeholder="Type your message..."
        :input-style="{ maxHeight: '300px' }"
        :class="['q-px-sm', content?.length ? 'q-pt-sm' : '', 'q-pb-md']"
        v-bind="$attrs"
        @keyup="checkKeyboardEvents"
      />
      <q-resize-observer @resize="onResize" />
    </div>
    <div v-if="!smallMode" class="left bar border-radius-inherit">
      <slot name="left" btn-size="sm"> </slot>
    </div>
    <!-- One positioned container that holds both toolbars -->
    <div class="bar top border-radius-inherit">
      <slot name="top" btn-size="sm" />
    </div>
    <div v-if="!smallMode" class="bar bottom border-radius-inherit">
      <slot name="bottom" btn-size="sm">
        <q-btn flat size="sm" :icon="matSend" @click="$emit('execute-task')">
          <q-tooltip>Send ({{ props.useEnterToSend ? 'Enter' : 'Shift+Enter' }})</q-tooltip>
        </q-btn>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { matSend } from '@quasar/extras/material-icons'
import { computed } from 'vue'
import { ref } from 'vue'

const h = ref(0)
const w = ref(0)
const heightLimitup = 65
const heightLimitdown = 75

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

const smallMode = computed<boolean>((previousSmall) => {
  if (previousSmall) {
    return h.value < heightLimitup
  }
  return h.value < heightLimitdown
})
</script>

<style scoped lang="scss">
/* container */
.msg-edit {
  position: relative;
}

.left {
  position: absolute;
  bottom: 0;
  left: 0;

  pointer-events: none; // don't block typing
}

.bottom {
  position: absolute;
  bottom: 0;
  right: 0;

  pointer-events: none; // don't block typing
}

.top {
  position: absolute;
  top: 0;
  right: 0;

  pointer-events: none; // don't block typing
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

.body--dark div.bar {
  background-color: rgba($dark, 0);
}
</style>
