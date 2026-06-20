<template>
  <div class="msg-edit rounded-borders">
    <!--{{ smallMode }} {{ h }}-->
    <div>
      <!-- Edit chat messages -->
      <q-input
        v-model="content"
        data-cy="chat-input"
        autogrow
        type="textarea"
        borderless
        :placeholder="placeholder"
        :input-style="{ maxHeight: '300px' }"
        :class="['q-px-sm', content?.length ? 'q-pt-sm' : '']"
        v-bind="$attrs"
        @keyup="checkKeyboardEvents"
        @paste="onPaste"
      >
        <template #before>
          <div v-show="smallMode">
            <slot name="left" btn-size="md" />
          </div>
        </template>
        <template v-if="smallMode" #after>
          <div v-show="smallMode">
            <q-btn
              class="msg-edit__send-button"
              flat
              :icon="matSend"
              @click="$emit('execute-task')"
            >
              <q-tooltip>{{ sendToolTip }}</q-tooltip>
            </q-btn>
            <q-btn
              v-if="showWebSearch"
              class="msg-edit__secondary-button"
              flat
              :icon="mdiSearchWeb"
              @click="$emit('execute-web-search')"
            >
              <q-tooltip> Use web search </q-tooltip>
            </q-btn>
          </div>
        </template>
      </q-input>
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
      <q-btn
        class="msg-edit__send-button"
        flat
        size="sm"
        :icon="matSend"
        @click="$emit('execute-task')"
      >
        <q-tooltip>{{ sendToolTip }}</q-tooltip>
      </q-btn>
      <q-btn
        v-if="showWebSearch"
        class="msg-edit__secondary-button"
        flat
        size="sm"
        :icon="mdiSearchWeb"
        @click="$emit('execute-web-search')"
      >
        <q-tooltip> <q-tooltip> Use web search </q-tooltip> </q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { matSend } from '@quasar/extras/material-icons'
import { mdiSearchWeb } from '@quasar/extras/mdi-v6'
import { useQuasar } from 'quasar'
import type { appConfiguration } from 'src/modules/taskyon/types'
import { computed, onBeforeUnmount } from 'vue'
import { ref } from 'vue'

const $q = useQuasar()
const enterMode = computed(() =>
  props.useEnterToSend === 'auto' ? ($q.platform.is.mobile ? 'off' : 'on') : props.useEnterToSend,
)

const sendToolTip = computed(
  () =>
    ({
      on: 'Send (Enter)',
      off: 'Send',
      shift: 'Send (Shift+Enter)',
    })[enterMode.value],
)

const content = defineModel<string | null | undefined>({
  required: true,
})

const props = defineProps<{
  useEnterToSend: appConfiguration['useEnterToSend']
  showWebSearch?: boolean
  placeholder?: string
}>()

const placeholder = computed(() => props.placeholder ?? 'Type your message...')

const emit = defineEmits<{
  (e: 'execute-task'): void
  (e: 'execute-web-search'): void
}>()

const checkKeyboardEvents = (event: KeyboardEvent) => {
  // Exit if not 'Enter' key or if sending is disabled
  if (event.key !== 'Enter' || enterMode.value === 'off') {
    return
  }

  // Map modes to their required 'shiftKey' state.
  // 'auto' resolves to 'false' for mobile (simple Enter) and 'true' for desktop (Shift+Enter).
  const shiftKeyRequirement = {
    on: false,
    shift: true,
  }

  // Check if the actual event's shiftKey matches the requirement for the current mode.
  const shouldSend = shiftKeyRequirement[enterMode.value] === event.shiftKey

  if (shouldSend) {
    emit('execute-task')
    event.preventDefault()
  }
}

const onPaste = (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return

  let hasFile = false
  for (const item of items) {
    if (item.kind === 'file') {
      hasFile = true
      break
    }
  }

  // If there is at least one file (e.g. pasted screenshot/image),
  // prevent the textarea from receiving the file path as text.
  // We *do not* stop propagation so FileDropzone's enable-paste
  // can still handle the same event and add the files.
  if (hasFile) {
    e.preventDefault()
  }
}

const SMALL_TO_LARGE = 80
const LARGE_TO_SMALL = 60

const h = ref(0)
const w = ref(0)
const smallMode = ref(true)

// type-safe RAF handle (no `any`)
let resizeRaf: number | null = null

const onResize = ({ height, width }: { height: number; width: number }) => {
  h.value = height
  w.value = width

  if (resizeRaf !== null) {
    cancelAnimationFrame(resizeRaf)
    resizeRaf = null
  }
  resizeRaf = requestAnimationFrame(() => {
    // true hysteresis
    if (smallMode.value) {
      if (height >= SMALL_TO_LARGE) smallMode.value = false
    } else {
      if (height <= LARGE_TO_SMALL) smallMode.value = true
    }
    resizeRaf = null
  })
}

onBeforeUnmount(() => {
  if (resizeRaf !== null) cancelAnimationFrame(resizeRaf)
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
