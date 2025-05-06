<template>
  <q-layout view="hHh lpR lFr">
    <TaskyonHeader :min-mode="false" btn-size="md" v-model:drawer-open="drawerOpen" />
    <q-drawer v-model="drawerOpen" show-if-above persistent behaviour="desktop" :width="250">
      <CreateNewTask
        :force-task-props="state.llmSettings.taskTemplate"
        class="q-pa-xs"
        expert-mode
        :hide-task-info="state.minimalGui"
      />
      <ObjectTreeView :model-value="functionArgs" />
    </q-drawer>
    <q-page-container>
      <UnderConstructionHint />
      <q-page padding>
        Tool Page {{ name }}
        <CodeEditor v-model="currentToolDefinition.code" />
        <q-btn
          :disable="!taskIsValid"
          :color="taskIsValid ? 'positive' : 'negative'"
          :icon="matSave"
          label="save task"
          @click="addNewTask()"
          ><q-tooltip>Save task without executing it...</q-tooltip></q-btn
        >
        {{ taskParser }}
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import TaskyonHeader from '../../components/taskyon/TaskyonHeader.vue'
import ObjectTreeView from 'src/components/ObjectTreeView.vue'
import CreateNewTask from 'src/components/taskyon/CreateNewTask.vue'
import { useAppStateStore } from 'src/stores/appState'
import UnderConstructionHint from 'src/components/UnderConstructionHint.vue'
import { matSave } from '@quasar/extras/material-icons'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { ToolBase } from 'src/modules/taskyon/types'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const CodeEditor = defineAsyncComponent(
  () =>
    import(
      /* webpackPrefetch: true */
      /* webpackChunkName: "codemirror" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      'src/components/CodeEditor.vue'
    ),
)

defineProps<{
  name: string
}>()

const state = useAppStateStore()
const tystate = useTaskyonStore()
const router = useRouter()

const functionArgs = ref<Record<string, unknown>>({})

const drawerOpen = ref(false)

const currentToolDefinition = ref<ToolBase & { code: string }>({
  name: '',
  description: '',
  parameters: {},
  code: '',
})

const taskParser = computed(() => {
  if (state.llmSettings.taskDraft.content.type === 'message') {
    try {
      const jsonToolResult = ToolBase.strict().safeParse(
        JSON.parse(state.llmSettings.taskDraft.content.data),
      )
      return jsonToolResult.success ? jsonToolResult.success : jsonToolResult.error
    } catch (error) {
      return error
    }
  }
  return 'task is not a message task!'
})

const taskIsValid = computed(() => !!taskParser.value)

async function addNewTask() {
  const tm = await tystate.getTaskManager()
  const newTask = await tm.addPartialTask2Tree(
    {
      role: 'user',
      content: {
        type: 'tooldefinition',
        data: currentToolDefinition.value,
      },
    },
    undefined,
    undefined,
  )
  void router.push({
    params: { name: newTask.id },
  })
}
</script>
