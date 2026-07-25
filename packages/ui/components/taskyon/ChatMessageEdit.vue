<template>
  <div class="msg-edit rounded-borders">
    <div>
      <q-input
        v-model="content"
        data-cy="chat-input"
        autogrow
        type="textarea"
        borderless
        :placeholder="resolvedPlaceholder"
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
            <q-btn class="msg-edit__send-button" flat :icon="matSend" @click="emit('executeTask')">
              <q-tooltip>{{ sendToolTip }}</q-tooltip>
            </q-btn>
            <q-btn
              v-if="showWebSearch"
              class="msg-edit__secondary-button"
              flat
              :icon="mdiSearchWeb"
              @click="emit('executeWebSearch')"
            >
              <q-tooltip>Use web search</q-tooltip>
            </q-btn>
          </div>
        </template>
      </q-input>
      <q-resize-observer @resize="onResize" />
    </div>
    <div v-if="!smallMode" class="left bar border-radius-inherit">
      <slot name="left" btn-size="sm" />
    </div>
    <div class="bar top border-radius-inherit">
      <slot name="top" btn-size="sm" />
    </div>
    <div v-if="!smallMode" class="bar bottom border-radius-inherit">
      <q-btn
        class="msg-edit__send-button"
        flat
        size="sm"
        :icon="matSend"
        @click="emit('executeTask')"
      >
        <q-tooltip>{{ sendToolTip }}</q-tooltip>
      </q-btn>
      <q-btn
        v-if="showWebSearch"
        class="msg-edit__secondary-button"
        flat
        size="sm"
        :icon="mdiSearchWeb"
        @click="emit('executeWebSearch')"
      >
        <q-tooltip>Use web search</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { matSend } from '@quasar/extras/material-icons'
import { mdiSearchWeb } from '@quasar/extras/mdi-v6'
import { useQuasar } from 'quasar'
import { computed, onBeforeUnmount, ref } from 'vue'

export type UseEnterToSendMode = 'auto' | 'on' | 'off' | 'shift'

const props = withDefaults(
  defineProps<{
    useEnterToSend?: UseEnterToSendMode
    showWebSearch?: boolean
    placeholder?: string
  }>(),
  {
    useEnterToSend: 'auto',
    showWebSearch: false,
    placeholder: 'Type your message...',
  },
)

const emit = defineEmits<{
  (e: 'executeTask'): void
  (e: 'executeWebSearch'): void
}>()

const content = defineModel<string | null | undefined>({ required: true })
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
const resolvedPlaceholder = computed(() => props.placeholder)

const checkKeyboardEvents = (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || enterMode.value === 'off') return
  const shouldSend = { on: false, shift: true }[enterMode.value] === event.shiftKey
  if (!shouldSend) return
  emit('executeTask')
  event.preventDefault()
}

const onPaste = (event: ClipboardEvent) => {
  const items = event.clipboardData?.items
  if (!items) return
  const hasFile = [...items].some((item) => item.kind === 'file')
  if (hasFile) event.preventDefault()
}

const smallMode = ref(true)
let resizeRaf: number | null = null

const onResize = ({ height }: { height: number; width: number }) => {
  if (resizeRaf !== null) cancelAnimationFrame(resizeRaf)
  resizeRaf = requestAnimationFrame(() => {
    if (smallMode.value) {
      if (height >= 80) smallMode.value = false
    } else if (height <= 60) {
      smallMode.value = true
    }
    resizeRaf = null
  })
}

onBeforeUnmount(() => {
  if (resizeRaf !== null) cancelAnimationFrame(resizeRaf)
})
</script>

<style scoped lang="scss">
.msg-edit {
  position: relative;
}

.left {
  position: absolute;
  bottom: 0;
  left: 0;
  pointer-events: none;
}

.bottom {
  position: absolute;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

.top {
  position: absolute;
  top: 0;
  right: 0;
  pointer-events: none;
}

div.bar {
  pointer-events: auto;
  background-color: rgba(white, 0);
  opacity: 1;
  backdrop-filter: blur(1px);
  -webkit-backdrop-filter: blur(1px);
}

.body--dark div.bar {
  background-color: rgba($dark, 0);
}
</style>
