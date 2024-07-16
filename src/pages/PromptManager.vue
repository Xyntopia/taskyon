<template>
  <q-page>
    <UnderConstructionHint />
    <div class="row q-gutter-xs fit q-pa-xs">
      <div class="col">
        <q-toggle v-model="edit" label="Edit Prompts" />
        <ObjectTreeView
          v-if="edit"
          :model-value="state.llmSettings.taskChatTemplates"
        />
        <q-card v-else flat>
          <q-card-section>
            <div>This is what the current prompt would look like:</div>
            <q-card
              v-for="(prompt, index) in structuredResponsePrompt"
              :key="index"
              class="q-pa-xs q-my-xs"
              bordereds
              flat
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
      <div class="col-6 column">
        <div class="text-caption text-center q-pt-sm">
          You can ask the AI here to help you changing the prompts!
        </div>
        <div class="col">
          <q-scroll-area class="fit">
            <conversation-widget
              :selected-thread="state.selectedThread"
              :state="state"
              :current-task="state.currentTask"
              :task-worker-waiting="state.taskWorkerWaiting"
            />
          </q-scroll-area>
        </div>
        <q-card class="col-auto q-pa-xs" flat>
          <CreateNewTask />
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import tyMarkdown from '../components/tyMarkdown.vue';
import { ref, computed } from 'vue';
import { useTaskyonStore } from 'src/stores/taskyonState';
import CreateNewTask from 'components/CreateNewTask.vue';
import ObjectTreeView from '../components/ObjectTreeView.vue';
import { TaskNode } from 'src/modules/taskyon/types';
import UnderConstructionHint from '../components/UnderConstructionHint.vue';
import { addPrompts } from 'src/modules/taskyon/promptCreation';
import ConversationWidget from 'src/components/ConversationWidget.vue';

const state = useTaskyonStore();

const edit = ref(false);

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
    const task: Pick<
      TaskNode,
      'role' | 'content' | 'allowedTools' | 'result' | 'debugging'
    > = {
      content: state.llmSettings.taskDraft.content,
      allowedTools: state.llmSettings.taskDraft.allowedTools,
      role: 'user',
      debugging: {},
    };
    task.role = 'user';

    console.log('create structured example', toolCollection.value);
    if (Object.keys(toolCollection.value).length !== 0) {
      const rp = addPrompts(task, toolCollection.value, state.llmSettings, []);
      return rp;
    }
  }
  return [];
});
</script>
