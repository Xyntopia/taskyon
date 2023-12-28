<template>
  <div v-if="props.task.configuration?.function" class="q-gutter-md q-px-xs">
      <div>
        <div class="text-bold"> arguments (yaml): </div>
        <div caption>
          <div class="scroll-area">
            {{ dump(task.configuration?.function?.arguments) }}
          </div>
        </div>
      </div>
      <div>
        <div class="text-bold"> result (yaml): </div>
        <div caption>
          <div class="scroll-area">
            {{ dump(task.result?.toolResult) }}
          </div>
        </div>
      </div>
  </div>
  <div v-else>
    <p>No tool selected</p>
  </div>
</template>

<style lang="sass" scoped>
.scroll-area
  white-space: pre-wrap
  box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.3)
</style>

<script setup lang="ts">
import { dump } from 'js-yaml';
import { LLMTask } from 'src/modules/taskyon/types';

const props = defineProps<{
  task: LLMTask;
}>();
</script>
