<template>
  <q-page>
    <UnderConstructionHint />
    <div class="row q-gutter-xs q-pa-xs">
      <div class="col fit">
        <q-toggle v-model="edit" label="Manually edit prompts" />
        <ObjectView
          v-if="edit && state.toolchainProfiles.base.taskyonFlow?.prompt_templates"
          v-model="
            state.toolchainProfiles.base.taskyonFlow.prompt_templates as Record<string, unknown>
          "
        />
        <q-card v-else flat>
          <q-card-section>
            <div>
              This is what the current base-prompt would look like (used in every conversation):
            </div>
            <q-card
              v-for="(prompt, index) in structuredResponsePrompt"
              :key="index"
              class="q-pa-xs q-my-xs"
              bordered
              flat
              :model-value="prompt"
            >
              <p class="text-bold text-secondary">role: {{ prompt.role }}</p>
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
          <create-task-button
            :markdown="currentPromptYaml"
            label="Start new conversation about prompts"
            outline
            :icon="mdiMagicStaff"
          />
        </div>
        <div v-if="tystate.currentTask.value" class="col">
          <q-scroll-area class="fit">
            <TaskChainViewer
              :selected-thread="tystate.selectedThread"
              :current-task="tystate.currentTask.value"
            />
          </q-scroll-area>
        </div>
        <q-card class="col-auto q-pa-xs" flat>
          <CreateNewTask :entry-node="tystate.entryNode" add-to-taskyon />
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import tyMarkdown from '@taskyon/ui/components/tyMarkdown.vue'
import { ref, computed } from 'vue'
import { useTaskyonStore } from 'src/stores/taskyonState'
import CreateNewTask from 'components/taskyon/CreateNewTask.vue'
import UnderConstructionHint from '@taskyon/ui/components/UnderConstructionHint.vue'
import TaskChainViewer from 'components/taskyon/TaskChainViewer.vue'
import { mdiMagicStaff } from '@quasar/extras/mdi-v6'
import CreateTaskButton from 'components/taskyon/CreateTaskButton.vue'
import { dump } from 'js-yaml'
import { useAppStateStore } from 'src/stores/appState'
import { buildEntryNodePromptPreviewMessages, normalizeEntryNodeSettings } from '@taskyon/taskyon'
import ObjectView from '@taskyon/ui/components/varViews/ObjectView.vue'

const tystate = useTaskyonStore()
const state = useAppStateStore()

const edit = ref(false)

/*//this is only needed if we need direct access to the codemirror element
//  add this to the <codemirror ...       @ready="handleReady" />
const view = shallowRef()
const handleReady = (payload) => {
  view.value = payload.view;
};
*/

const currentPromptYaml = computed(() => {
  return `

<!--taskyon
role: user
name: change prompts
label: ["discard", "hide"]
-->

The following are our current taskyon prompts:

---

<!--taskyon
role: system
name: current taskyon prompts
label: ["discard", "hide"]
-->

${dump(state.toolchainProfiles.base.taskyonFlow?.prompt_templates, { forceQuotes: true })}

---

<!--taskyon
role: user
name: request assisted prompt change
label: ["discard", "hide"]
-->

I would like to change the prompts for taskyon AI. Taskyon AI uses a variety of prompts \
which are added to the chat based on the type of expected message. For example if tools \
are enabled, a prompt is added which informs Taskyon about the available tools. Another prompt \
is added which explains the required return format.

Available prompts are:

${Object.keys(state.toolchainProfiles.base.taskyonFlow?.prompt_templates ?? {})
  .map((x) => '- ' + x)
  .join('\n')}

Please give back the modified object in the exact same format as above in yaml. \
You can leave out any yaml keys, if you think its only required to change a specific key.

---

<!--taskyon
role: assistant
name: ask for prompt modification
label: ["discard"]
-->

How would you like to change the prompt?
`
})

const structuredResponsePrompt = computed(() => {
  if (tystate.taskContentDraft) {
    const settings = normalizeEntryNodeSettings(state.toolchainProfiles.base.taskyonFlow)
    return buildEntryNodePromptPreviewMessages({
      prompt:
        typeof tystate.taskContentDraft === 'string'
          ? tystate.taskContentDraft
          : dump(tystate.taskContentDraft),
      templates: settings.prompt_templates,
      useBasePrompt: settings.use_baseprompt,
    }).map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    }))
  }
  return []
})
</script>
