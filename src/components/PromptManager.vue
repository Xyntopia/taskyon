<template>
  <div class="q-ma-sm">
    <UnderConstructionHint />
    <div class="row q-gutter-md">
      <ObjectTreeView
        style="min-width: 500px"
        class="col"
        :model-value="state.llmSettings.taskChatTemplates"
      />
      <q-card flat class="col" style="min-width: 500px">
        <q-card-section>
          <CreateNewTask />
          <div>This is what the current prompt would look like:</div>
        </q-card-section>
        <q-card-section>
          and the prompts:
          <q-card
            class="q-pa-xs q-my-xs"
            bordered
            flat
            v-for="(prompt, index) in structuredResponsePrompt"
            :key="index"
            :model-value="prompt"
          >
            <p class="text-bold">role: {{ prompt.role }}</p>
            <p style="white-space: pre-wrap">
              {{ prompt.content }}
            </p>
            <tyMarkdown v-if="false" :src="`${prompt.content}`" />
          </q-card>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import tyMarkdown from './tyMarkdown.vue';
import { ref, computed } from 'vue';
import { useTaskyonStore } from 'src/stores/taskyonState';
import CreateNewTask from 'components/CreateNewTask.vue';
import ObjectTreeView from './ObjectTreeView.vue';
import { LLMTask } from 'src/modules/taskyon/types';
import UnderConstructionHint from './UnderConstructionHint.vue';
import { renderTaskPrompt4Chat } from 'src/modules/taskyon/promptCreation';

const state = useTaskyonStore();

/*//this is only needed if we need direct access to the codemirror element
//  add this to the <codemirror ...       @ready="handleReady" />
const view = shallowRef()
const handleReady = (payload) => {
  view.value = payload.view;
};
*/

async function getAllTools() {
  return (await state.getTaskManager()).searchToolDefinitions();
}

const toolCollection = ref<Awaited<ReturnType<typeof getAllTools>>>({});
void getAllTools().then((tools) => {
  console.log('tools:', tools);
  toolCollection.value = tools;
});

const structuredResponsePrompt = computed(() => {
  if (state.llmSettings.taskDraft.content) {
    const task: Pick<LLMTask, 'role' | 'content' | 'allowedTools' | 'result'> =
      {
        content: state.llmSettings.taskDraft.content,
        allowedTools: state.llmSettings.taskDraft.allowedTools,
        role: 'user',
      };
    task.role = 'user';

    console.log('create structured example', toolCollection.value);
    if (Object.keys(toolCollection.value).length !== 0) {
      const rp = renderTaskPrompt4Chat(
        task,
        toolCollection.value,
        state.llmSettings
      );
      return rp;
    }
  }
  return [];
});
</script>
