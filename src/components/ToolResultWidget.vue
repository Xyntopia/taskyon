<template>
  <div v-if="props.task.configuration?.function" class="q-gutter-md q-px-xs">
    <div>
      <div class="text-bold">arguments (yaml):</div>
      <div caption>
        <div class="scroll-area">
          {{ dump(task.configuration?.function?.arguments) }}
        </div>
      </div>
    </div>
    <div>
      <div class="text-bold">
        result (yaml):
        <q-btn
          class="q-ml-md"
          icon="html"
          dense
          flat
          @click="useIframe = !useIframe"
        />
      </div>
      <div caption class="relative-position">
        {{ useIframe }}
        <div v-if="!isHtmlResult && !useIframe" class="scroll-area">
          {{ dump(task.result?.toolResult) }}
        </div>
        <iframe v-else :srcdoc="task.result?.toolResult?.result"></iframe>
        <q-btn
          class="scroll-area-btn"
          flat
          icon="content_copy"
          @click="copyToClipboard(task.result?.toolResult)"
        />
      </div>
    </div>
  </div>
  <div v-else>
    <p>No tool selected</p>
  </div>
</template>

<style lang="sass" scoped>

.scroll-area-btn
  position: absolute
  top: 0px // Adjust as needed for proper alignment
  right: 0px // Adjust as needed for proper alignment
  z-index: 10 // Ensure the button is above other content

.scroll-area
  white-space: pre-wrap
  box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.3)
  max-height: 300px // Adjust this value based on your needs
  overflow-y: auto
  width: auto // Ensures it takes the necessary width up to its parent's maximum
  min-width: 100% // Ensures it stretches to at least the width of its parent
</style>

<script setup lang="ts">
import { dump } from 'js-yaml';
import { LLMTask } from 'src/modules/taskyon/types';
import { computed, ref } from 'vue';

const props = defineProps<{
  task: LLMTask;
}>();

const useIframe = ref(false);

function copyToClipboard(data: unknown) {
  void navigator.clipboard.writeText(dump(data));
}

const isHtmlResult = computed(() => {
  const toolResult = props.task.result?.toolResult;
  // Simple check for HTML - you might need a more accurate way to determine this
  let isHtml = false;
  if (typeof toolResult?.result === 'string') {
    //#const isHtml= toolResult.trim().startsWith('<');
    isHtml = toolResult.result.trim().startsWith('<');
  }
  return isHtml;
});
</script>
