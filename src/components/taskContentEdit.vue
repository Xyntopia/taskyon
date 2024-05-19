<template>
  <q-input
    autogrow
    filled
    dense
    color="secondary"
    v-model="content"
    label="Type your message or instruction..."
    clearable
    @keyup="checkKeyboardEvents"
    input-style="max-height: 300px"
    v-bind="$attrs"
  >
    <template v-slot:append>
      <q-btn flat dense round icon="send" @click="executeTask">
        <q-tooltip>
          Press to send or alternatively send with &lt;shift&gt; + &lt;enter&gt;
        </q-tooltip>
      </q-btn>
    </template>
    <template v-slot:before>
      <FileDropzone class="fit" @update:model-value="attachFileToChat">
        <q-btn dense class="fit" flat>
          <q-icon class="gt-sm" name="upload_file" />
          <q-icon name="attachment" />
          <q-tooltip>Attach file to message</q-tooltip>
        </q-btn>
      </FileDropzone>
    </template>
    <template v-slot:after>
      <taskSettingsButton v-model="expandedTaskCreation" />
    </template>
  </q-input>
</template>

<script setup lang="ts">
import FileDropzone from './FileDropzone.vue';
import taskSettingsButton from './taskSettingsButton.vue';

const content = defineModel<string | null | undefined>({
  required: true,
});
const expandedTaskCreation = defineModel<boolean>('expandedTaskCreation', {
  required: true,
});

const props = defineProps<{
  expertMode: boolean;
  executeTask: () => Promise<void>;
  attachFileToChat: (newFiles: File[]) => void;
  useEnterToSend: boolean;
}>();

const checkKeyboardEvents = (event: KeyboardEvent) => {
  if (props.useEnterToSend) {
    if (!event.shiftKey && event.key === 'Enter') {
      void props.executeTask();
      // Prevent a new line from being added to the input (optional)
      event.preventDefault();
    }
    // otherwise it'll simply be the default action and inserting a newline :)
  } else {
    if (event.shiftKey && event.key === 'Enter') {
      void props.executeTask();
      // Prevent a new line from being added to the input (optional)
      event.preventDefault();
    }
    // otherwise it'll simply be the default action and inserting a newline :)
  }
};
</script>
