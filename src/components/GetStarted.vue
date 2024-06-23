<template>
  <div class="welcome-message column items-center">
    <div
      class="text-h6 col-auto"
      v-if="
        state.llmSettings.selectedApi &&
        state.keys[state.llmSettings.selectedApi]
      "
    >
      <p class="text-center welcome-message-text">
        Welcome! Just type a message below to start using Taskyon!
      </p>
      <div class="row q-gutter-xs items-top justify-around">
        <div
          class="col-2 text-caption text-secondary"
          v-for="(s, idx) in starters"
          :key="idx"
        >
          <CreateTaskButton
            :markdown="s"
            outline
            :color="$q.dark.isActive ? 'secondary' : 'primary'"
          />
        </div>
      </div>
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
    `
<!--taskyon
name: Currently recommended models
role: "assistant"
-->
Currently we recommended the following Models:
  - llama-3
  - GPT4o
  - Gemini
  - try out more!

You can select them in the "Chat Settings" section in the message input window.
`,
    // TODO:
    //'How do I execute python code?',
    //'how about testing out javascript? e.g. create some widgets on the fly...',
    //'What are AI tools?',
    //'How do I integrate Taskyon into my webpage?',
  ];
});
</script>
