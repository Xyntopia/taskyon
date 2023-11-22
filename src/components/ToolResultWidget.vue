<template>
  <q-list dense separator bordered v-if="props.task.context?.function">
    <q-item>
      <q-item-section>
        <q-item-label> arguments (yaml): </q-item-label>
        <q-item-label caption>
          <div class="scroll-area">
            {{ dump(task.context?.function?.arguments) }}
          </div>
        </q-item-label>
      </q-item-section>
    </q-item>
    <q-item>
      <q-item-section>
        <q-item-label> result (yaml): </q-item-label>
        <q-item-label caption>
          <div class="scroll-area">
            {{ dump(task.result?.functionResult) }}
          </div>
        </q-item-label>
      </q-item-section>
    </q-item>
  </q-list>
  <div v-else>
    <p>No tool selected</p>
  </div>
</template>

<style lang="sass" scoped>
.scroll-area
  white-space: pre-wrap
  background-color: darken($primary, 5%)
</style>

<script setup lang="ts">
import { defineProps } from 'vue';
import { dump } from 'js-yaml';
import { LLMTask } from 'src/modules/types';

const props = defineProps<{
  task: LLMTask;
}>();
</script>
