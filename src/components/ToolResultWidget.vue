<template>
  <div v-if="props.task.context?.function" class="q-gutter-md q-px-xs">
      <div>
        <div class="text-bold"> arguments (yaml): </div>
        <div caption>
          <div class="scroll-area">
            {{ dump(task.context?.function?.arguments) }}
          </div>
        </div>
      </div>
      <div>
        <div class="text-bold"> result (yaml): </div>
        <div caption>
          <div class="scroll-area">
            {{ dump(task.result?.functionResult) }}
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
import { defineProps } from 'vue';
import { dump } from 'js-yaml';
import { LLMTask } from 'src/modules/types';

const props = defineProps<{
  task: LLMTask;
}>();
</script>
