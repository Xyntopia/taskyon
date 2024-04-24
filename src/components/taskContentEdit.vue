<template>
  <q-input
    v-if="!selectedTaskType"
    autogrow
    filled
    dense
    color="secondary"
    v-model="content"
    label="Type your message or instruction..."
    :bottom-slots="expertMode"
    :counter="expertMode"
    clearable
    @keyup="checkKeyboardEvents"
    input-style="max-height: 300px"
  >
    <template v-slot:append>
      <q-btn flat dense round icon="send" @click="executeTask">
        <q-tooltip>
          Press to send or alternatively send with &lt;shift&gt; + &lt;enter&gt;
        </q-tooltip>
      </q-btn>
    </template>
    <template v-slot:before>
      <FileDropzone class="fit" @update:model-value="attachFileToTask">
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
    <template v-slot:counter>
      <div>
        {{ `approx. token count: ${estimatedTokens}` }}
      </div>
    </template>
    <template v-slot:hint>
      <div class="ellipsis">
        {{ `${currentModel} (selected AI)` }}
      </div>
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
defineProps<{
  selectedTaskType: string | undefined;
  expertMode: boolean;
  checkKeyboardEvents: (event: KeyboardEvent) => void;
  executeTask: () => Promise<void>;
  attachFileToTask: (newFiles: File[]) => Promise<void>;
  estimatedTokens: number;
  currentModel: string | undefined;
}>();
</script>
