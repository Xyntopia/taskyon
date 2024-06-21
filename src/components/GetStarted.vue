<template>
  <div class="welcome-message column items-center">
    <div
      class="text-h6 col-auto"
      v-if="
        state.llmSettings.selectedApi &&
        state.keys[state.llmSettings.selectedApi]
      "
    >
      <p class="text-center text-secondary">
        Welcome! Just type a message below to start using Taskyon!
      </p>
      <CreateTaskButton :markdown="introTask" />
      <!--<div class="row">
        <div
          class="col text-caption text-secondary"
          v-for="(s, idx) in starters"
          :key="idx"
        >
          <CreateTaskButton :markdown="s" />
        </div>
      </div>-->
    </div>
    <LLMProviders v-else />
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import LLMProviders from './LLMProviders.vue';
import CreateTaskButton from './CreateTaskButton.vue';
import { ref, computed } from 'vue';

const state = useTaskyonStore();

const introTask = ref('');

void (async () => {
  // Fetch the markdown file from the URL
  const response = await fetch('/docs/conversations/features_intro.md');
  if (!response.ok) {
    throw new Error(`Failed to fetch markdown file: ${response.statusText}`);
  }
  introTask.value = await response.text();
})();

const starters = computed(() => {
  return [
    introTask.value,
    `Current recommended Models:
  - the free versions
  - llama-3
  - GPT4o
  - Gemini
  - try out more!
`,
    "how about trying out fun with 'mermaid'?  E.g. create a gantt chart for your project!",
    'how about creating some python programs?',
    'how about testing out javascript? e.g. create some widgets on the fly...',
    'how about creating a new tool?',
    'integration of taskyon into your webpage is so easy!',
  ];
});
</script>
