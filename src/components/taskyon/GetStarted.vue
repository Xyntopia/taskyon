<template>
  <div class="welcome-message column items-center">
    <div
      v-if="state.llmSettings.selectedApi && state.keys[state.llmSettings.selectedApi]"
      class="text-h6 col-auto"
    >
      <p class="text-center welcome-message-text">
        Welcome! Just type a message below to start using Taskyon!
      </p>
      <div class="row q-gutter-xs justify-about">
        <div v-for="(s, idx) in starters" :key="idx" class="col">
          <CreateTaskButton
            v-if="s.md"
            :markdown="s.md"
            :label="s.label"
            outline
            no-caps
            :color="$q.dark.isActive ? 'secondary' : 'primary'"
          />
          <q-btn
            v-else-if="s.url"
            :to="s.url.toString()"
            :label="s.label"
            outline
            no-caps
            :color="$q.dark.isActive ? 'secondary' : 'primary'"
          />
        </div>
      </div>
    </div>
    <LLMProviders v-else :expert-mode-on="state.appConfiguration.expertMode" />
  </div>
</template>

<script setup lang="ts">
import LLMProviders from './LLMProviders.vue'
import CreateTaskButton from './CreateTaskButton.vue'
import { computed } from 'vue'
import { useAppStateStore } from 'src/stores/appState'
import { useQuasar } from 'quasar'

const state = useAppStateStore()

const $q = useQuasar()

const starters = computed(() => {
  return [
    {
      url: 'chat/docs/conversations/features_intro',
      label: 'Showcase Taskyons features',
    },
    {
      url: 'chat/docs/examples/simpleExampleTutorial',
      label: 'How do I integrate taskyon into my own webpage?',
    },
    {
      md: `
<!--taskyon
name: Currently recommended models
role: "user"
label: ["discard"]
-->

Which models do you currently recommend?

---
<!--taskyon
name: Currently recommended models
role: "assistant"
label: ["discard"]
-->

Some AI models to get you started with:

  - meta-llama/llama-3.2-90b-vision-instruct: much cheaper than GPT4o and best for most tasks (including coding) and if you want to use "tools"
  - openai/gpt-4o: visual tasks and if you need t work in languages other than english
  - meta-llama/llama-3.2-11b-vision-instruct:  a very good "free" model
  - checkout the entire list of models and descriptions [here](https://taskyon.space/pricing)!

You can select them in the "Chat Settings" section in the message input window.
`,
      label: 'Show currently recommend models',
    },
    // TODO:
    //'How do I execute python code?',
    //'how about testing out javascript? e.g. create some widgets on the fly...',
    //'What are AI tools?',
    //'How do I integrate Taskyon into my webpage?',
  ]
})
</script>
