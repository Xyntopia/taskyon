<template>
  <q-layout view="hHh lpR lFr">
    <TaskyonHeader v-model:drawer-open="drawerOpen" :min-mode="false" btn-size="md" />
    <!--<q-drawer v-model="drawerOpen" show-if-above persistent behaviour="desktop" :width="250">
      <CreateNewTask class="q-pa-xs" expert-mode />
      <ObjectTreeView :model-value="functionArgs" />
    </q-drawer>-->
    <q-page-container>
      <UnderConstructionHint />
      <q-page padding>
        <div class="row">
          <q-select
            class="col"
            use-input
            dense
            hide-selected
            fill-input
            options-dense
            input-debounce="0"
            borderless
            color="secondary"
            :model-value="selectedTool?.name"
            :options="filteredToolCollection"
            :label="selectedTool ? 'selected Tool' : 'Select Tool'"
            behavior="default"
            @filter="filterFn"
            @update:model-value="switchTool"
          >
            <template #before>
              <q-icon :name="mdiToolbox" />
            </template>
          </q-select>
          <q-btn flat dense label="New Tool" @click="switchTool()" />
        </div>
        <q-separator class="q-my-md" />
        <div v-if="selectedTool || !name" class="column q-gutter-sm">
          <q-input v-model="toolDraft.name" dense filled label="New Tool Name" />
          <div class="row">
            <q-tabs v-model="selectedTab" class="col-auto" dense no-caps vertical>
              <q-tab name="code" :icon="mdiLanguageJavascript" label="tool code" />
              <q-tab name="configure" :icon="mdiFormTextbox" label="tool configuration" />
              <q-tab name="definition" :icon="mdiCodeJson" label="tool definition" />
            </q-tabs>
            <q-tab-panels :model-value="selectedTab" animated swipeable infinite class="col">
              <q-tab-panel name="code">
                <div v-if="selectedTool && selectedTool.function" class="q-pa-lg text-negative">
                  The currently selected Tool is a Taskyon-internal tool with a "function" property
                  and can not be edited here. You can however replace it with your own tool with the
                  same name.
                </div>
                <div v-if="toolDraft.code" class="column">
                  <q-btn
                    class="self-end"
                    flat
                    dense
                    :icon="matContentCopy"
                    label="copy as js string"
                    @click="copyAsJsString(toolDraft.code)"
                  />
                  <CodeEditor v-model="toolDraft.code" />
                </div>
                <div v-else>
                  This tool dosn't contain any code. It might be a taskyon-internal tool, an
                  external tool defined on a parent webpage or from an MCP server.
                  <q-btn
                    label="Add tool code"
                    :icon="matAdd"
                    @click="() => (toolDraft.code = freshTool.code)"
                  />
                </div>
                {{ toolParser }}
              </q-tab-panel>
              <q-tab-panel name="configure">
                <ObjectTreeView :model-value="toolDraft" :schema="toolJsonSchema" />
              </q-tab-panel>
              <q-tab-panel name="definition" class="column">
                <JsonInput v-model="toolDraft" filled auto-save />
              </q-tab-panel>
            </q-tab-panels>
          </div>
          <q-btn
            class="q-mt-md"
            :disable="!isValidTool"
            :color="isValidTool ? 'positive' : 'negative'"
            :icon="matSave"
            label="save tool"
            @click="addNewTask()"
            ><q-tooltip>Save tool inside our tasktree.</q-tooltip></q-btn
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
              v-for="t in alphabeticalTools"
              :key="t.name"
              dense
              flat
              :to="{ path: `/tool/${t.name}` }"
              >{{ t.name }}</q-btn
            >
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from 'vue'
import TaskyonHeader from '../../components/taskyon/TaskyonHeader.vue'
import ObjectTreeView from 'src/components/ObjectTreeView.vue'
import UnderConstructionHint from 'src/components/UnderConstructionHint.vue'
import { matAdd, matContentCopy, matSave } from '@quasar/extras/material-icons'
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
  mdiToolbox,
} from '@quasar/extras/mdi-v6'
import JsonInput from 'src/components/JsonInput.vue'
import { copyToClipboard } from 'quasar'

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
const freshTool = {
  name: '',
  description: '',
  parameters: {},
  code: `(param_obj, {taskChain, setSecret, getSecret}) => {
  console.log('calling with params:', param_obj)
}`,
}
const toolDraft = ref<ToolBase>(freshTool)

const copyAsJsString = (txt: string) => {
  // 1) remove exactly one trailing newline, if present
  const trimmed = txt.endsWith('\n') ? txt.slice(0, -1) : txt

  // 2) escape backslashes, backticks and `${…}` so nothing gets broken or interpolated
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

  // 3) wrap in backticks
  void copyToClipboard(`\`${escaped}\``)
}

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

function switchTool(toolName?: string) {
  void router.push({ path: '/tool' + (toolName ? `/${toolName}` : '') })
}

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

const selectedTool = asyncComputed<InternalTool | undefined>(
  async () => {
    const tm = await tystate.getTaskManager()
    if (name) {
      const { tool } = await tm.getToolDefinition(name)
      if (tool) return tool
      // otherwise check if name is actually a task id...
      const toolDefTask = await tm.getTask(name)
      if (toolDefTask?.content.type === 'tooldefinition') return toolDefTask.content.data
    }
    return undefined
  },
  undefined,
  () => name,
)

watch(
  selectedTool,
  (newTool) => {
    toolDraft.value = newTool
      ? {
          ...newTool,
          name: newTool.name + '_copy',
        }
      : freshTool
  },
  { immediate: true },
)

const toolJsonSchema = craeteToolJsonSchema()

const toolParser = computed(() => {
  try {
    // we are copying th whole thing as json to make sure we have a legitimate json :)
    const toolCopy = JSON.parse(JSON.stringify(toolDraft.value))
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
        data: JSON.parse(JSON.stringify(toolDraft.value)),
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
