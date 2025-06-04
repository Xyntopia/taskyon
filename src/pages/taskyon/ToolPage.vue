<template>
  <q-layout view="hHh lpR lFr">
    <TaskyonHeader :min-mode="false" btn-size="md" v-model:drawer-open="drawerOpen" />
    <q-drawer v-model="drawerOpen" show-if-above persistent behaviour="desktop" :width="250">
      <CreateNewTask class="q-pa-xs" expert-mode />
      <ObjectTreeView :model-value="functionArgs" />
    </q-drawer>
    <q-page-container>
      <UnderConstructionHint />
      <q-select
        class="col"
        use-input
        dense
        hide-selected
        fill-input
        options-dense
        input-debounce="0"
        borderless
        @filter="filterFn"
        color="secondary"
        :model-value="selectedTool?.name"
        :options="filteredToolCollection"
        :label="selectedTool ? 'selected Tool' : 'Select Tool'"
        @update:model-value="switchTool"
        behavior="default"
      />
      <q-page padding>
        <div v-if="selectedTool || !name" class="column">
          <div class="row">
            <q-tabs v-model="selectedTab" class="col-auto" dense no-caps vertical>
              <q-tab name="code" :icon="mdiLanguageJavascript" label="tool code" />
              <q-tab name="configure" :icon="mdiFormTextbox" label="tool configuration" />
              <q-tab name="definition" :icon="mdiCodeJson" label="tool definition" />
            </q-tabs>
            <q-tab-panels :model-value="selectedTab" animated swipeable infinite class="col">
              <q-tab-panel name="code">
                <div class="q-pa-lg text-negative" v-if="currentToolDefinition.function">
                  The current Tool is a Taskyon-internal tool with a "function" property and can not
                  be edited here. You can however replace it with your own tool with the same name.
                </div>
                <CodeEditor
                  v-else-if="currentToolDefinition.code"
                  v-model="currentToolDefinition.code"
                />
                {{ toolParser }}
              </q-tab-panel>
              <q-tab-panel name="configure">
                <ObjectTreeView
                  :model-value="{ ...currentToolDefinition, code: undefined }"
                  :schema="toolJsonSchema"
                />
              </q-tab-panel>
              <q-tab-panel name="definition" class="column">
                <JsonInput filled v-model="currentToolDefinition" auto-save />
              </q-tab-panel>
            </q-tab-panels>
          </div>
          <q-btn
            class="q-mt-md"
            :disable="!isValidTool"
            :color="isValidTool ? 'positive' : 'negative'"
            :icon="matSave"
            label="save task"
            @click="addNewTask()"
            ><q-tooltip>Save task without executing it...</q-tooltip></q-btn
          >
        </div>
        <div v-else>
          The selected tool "{{ name }}" is not available for editing. Please select one of the
          following tools or:
          <q-btn flat class="q-ma-sm" :to="{ path: '/tool' }">
            <div>
              create a new tool.
              <q-icon :name="mdiMagicStaff" />
              <q-icon :name="mdiFunctionVariant" />
            </div>
          </q-btn>

          <div v-if="alphabeticalTools" class="column q-mt-sm">
            <q-btn
              dense
              flat
              :to="{ path: `/tool/${t.name}` }"
              v-for="t in alphabeticalTools"
              :key="t.name"
              >{{ t.name }}</q-btn
            >
          </div>
        </div>
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
import type { InternalTool } from 'src/modules/taskyon/tools'
import { craeteToolJsonSchema } from 'src/modules/taskyon/tools'
import {
  mdiCodeJson,
  mdiFormTextbox,
  mdiFunctionVariant,
  mdiLanguageJavascript,
  mdiMagicStaff,
} from '@quasar/extras/mdi-v6'
import JsonInput from 'src/components/JsonInput.vue'

const { name } = defineProps<{ name?: string }>()

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

const selectedTab = ref('code')
const tystate = useTaskyonStore()
const router = useRouter()
const toolCollection = asyncComputed(tystate.getAllTools, {})
const toolNames = computed(() => Object.keys(toolCollection.value))

const filteredToolCollection = ref<string[]>([])
const filterFn = (inputValue: string, doneFn: (callbackFn: () => void) => void) => {
  if (inputValue === '') {
    doneFn(() => {
      filteredToolCollection.value = toolNames.value
    })
    return
  }

  doneFn(() => {
    const needle = inputValue.toLowerCase()
    filteredToolCollection.value = toolNames.value.filter(
      (v) => v.toLowerCase().indexOf(needle) > -1,
    )
  })
}

function switchTool(toolName: string) {
  void router.push({ path: `/tool/${toolName}` })
}

const functionArgs = ref<Record<string, unknown>>({})
const drawerOpen = ref(false)

const allTools = asyncComputed(async () => {
  const tm = await tystate.getTaskManager()
  const tools = await tm.updateToolDefinitions()
  return tools
}, undefined)

const alphabeticalTools = computed(() => {
  return allTools.value
    ? Object.values(allTools.value).sort((a, b) => a.name.localeCompare(b.name))
    : undefined
})

const selectedTool = asyncComputed(
  async () => {
    const tm = await tystate.getTaskManager()
    if (name) return await tm.getTool(name)
    else return undefined
  },
  undefined,
  () => name,
)

const toolJsonSchema = craeteToolJsonSchema()

const currentToolDefinition = computed<InternalTool>(() => {
  return selectedTool.value
    ? { code: 'define your code here!', ...selectedTool.value }
    : {
        name: '',
        description: '',
        parameters: {},
        code: '',
      }
})

const toolParser = computed(() => {
  try {
    const toolCopy = JSON.parse(JSON.stringify(currentToolDefinition.value))
    const jsonToolResult = ToolBase.strict().safeParse(toolCopy)
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
        // we are doing this to 1. make sure its json parsable and 2. create a copy of the current tool...
        data: JSON.parse(JSON.stringify(currentToolDefinition.value)),
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
