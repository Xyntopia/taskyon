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
          <q-btn flat :icon="matSend" @click="$emit('execute-task')">
            <q-tooltip>{{ sendToolTip }}</q-tooltip>
          </q-btn>
          <q-btn
            v-if="showWebSearch"
            flat
            :icon="mdiSearchWeb"
            @click="$emit('execute-web-search')"
          >
            <q-tooltip> Use web search </q-tooltip>
          </q-btn>
        </template> </q-input
      ><q-input
        v-else
        v-model="content"
        autogrow
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
      <q-btn flat size="sm" :icon="matSend" @click="$emit('execute-task')">
        <q-tooltip>{{ sendToolTip }}</q-tooltip>
      </q-btn>
      <q-btn
        v-if="showWebSearch"
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
import { computed } from 'vue'
import { ref } from 'vue'

const $q = useQuasar()
const h = ref(0)
const w = ref(0)
const heightLimitup = 65
const heightLimitdown = 75
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
}>()

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
