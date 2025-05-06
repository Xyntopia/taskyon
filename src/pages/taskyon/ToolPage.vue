<template>
  <q-layout view="hHh lpR lFr">
    <TaskyonHeader :min-mode="false" btn-size="md" v-model:drawer-open="drawerOpen" />
    <q-drawer v-model="drawerOpen" show-if-above persistent behaviour="desktop" :width="250">
      <CreateNewTask class="q-pa-xs" expert-mode />
      <ObjectTreeView :model-value="functionArgs" />
    </q-drawer>
    <q-page-container>
      <UnderConstructionHint />
      <q-page padding>
        Tool Page {{ name }}
        <CodeEditor v-model="currentToolDefinition.code" />
        <q-btn
          :disable="!isValidTool"
          :color="isValidTool ? 'positive' : 'negative'"
          :icon="matSave"
          label="save task"
          @click="addNewTask()"
          ><q-tooltip>Save task without executing it...</q-tooltip></q-btn
        >
        {{ toolParser }}
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import TaskyonHeader from '../../components/taskyon/TaskyonHeader.vue'
import ObjectTreeView from 'src/components/ObjectTreeView.vue'
import CreateNewTask from 'src/components/taskyon/CreateNewTask.vue'
import UnderConstructionHint from 'src/components/UnderConstructionHint.vue'
import { matSave } from '@quasar/extras/material-icons'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { ToolBase } from 'src/modules/taskyon/types'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { asyncComputed } from 'src/modules/vueUtils'

const { name } = defineProps<{ name: string }>()

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

const tystate = useTaskyonStore()
const router = useRouter()

const functionArgs = ref<Record<string, unknown>>({})
const drawerOpen = ref(false)

type PluginTool = ToolBase & { code: string }

const selectedTool = asyncComputed(async () => {
  const tm = await tystate.getTaskManager()
  const task = await tm.getTask(name)
  if (task?.content.type === 'tooldefinition') {
    return task.content.data
  } else {
    return undefined
  }
}, undefined)

const currentToolDefinition = computed<PluginTool>(() => {
  return selectedTool.value
    ? ({ code: 'define your code here!', ...selectedTool.value } as PluginTool)
    : {
        name: '',
        description: '',
        parameters: {},
        code: '',
      }
})

const toolParser = computed(() => {
  try {
    const jsonToolResult = ToolBase.strict().safeParse(currentToolDefinition)
    return jsonToolResult.success ? jsonToolResult.success : jsonToolResult.error
  } catch (error) {
    return error
  }
})

const isValidTool = computed(() => toolParser.value === true)

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
