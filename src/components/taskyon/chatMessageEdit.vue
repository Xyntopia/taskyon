<template>
  <!--edit chat messages-->
  <q-input
    v-model.trim="content"
    autogrow
    borderless
    color="secondary"
    placeholder="Type your message or instruction..."
    clearable
    input-style="max-height: 300px"
    v-bind="$attrs"
    @keyup="checkKeyboardEvents"
  >
    <template #append>
      <q-btn
        flat
        dense
        round
        :icon="matSend"
        :color="$q.dark.isActive ? 'white' : 'dark'"
        @click="$emit('execute-task')"
      >
        <q-tooltip>
          Press to send or alternatively send with &lt;shift&gt; + &lt;enter&gt;
        </q-tooltip>
      </q-btn>
    </template>
  </q-input>
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
