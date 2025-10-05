<template>
  <!--<q-drawer v-model="drawerOpen" show-if-above persistent behaviour="desktop" :width="250">
      <CreateNewTask class="q-pa-xs" expert-mode />
      <ObjectTreeView :model-value="functionArgs" />
    </q-drawer>-->
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
      <div>
        <TaskChainPublishDialog
          v-if="preliminaryTaskNode"
          buttons
          download
          flat
          share
          single
          :task-or-id="preliminaryTaskNode"
        >
          <template #tt-cp-btn> <div class="q-px-sm">Copy Tool as Markdown</div></template>
          <template #tt-share-btn> <div class="q-px-sm">Share Tool Online</div></template>
        </TaskChainPublishDialog>
        <q-btn
          flat
          :icon="matSearch"
          label="Search for similar tools"
          :to="`/taskmanager?k=10&ct=tooldefinition&q=${JSON.stringify(selectedTool)}`"
        />
        <q-btn flat label="Secrets" :icon="mdiKeyChain" to="/settings/secrets" />
        <div class="row items-center">
          <q-btn
            class="col-auto"
            :disable="!isValidTool"
            :color="isValidTool ? 'positive' : 'negative'"
            :icon="matSave"
            label="save tool"
            @click="
              () => {
                if (preliminaryTaskNode) addNewTask(preliminaryTaskNode)
              }
            "
            ><q-tooltip>{{
              isValidTool
                ? 'Save tool inside our tasktree.'
                : 'Only Valid tools can be saved, check the definition for errors!'
            }}</q-tooltip></q-btn
          >
          <div v-if="!isValidTool" class="col">
            The tool definition contains errors:
            <div class="q-pa-sm text-negative">{{ toolParser }}</div>
          </div>
        </div>
      </div>
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
              The currently selected Tool is a Taskyon-internal tool with a "function" property and
              can not be edited here. You can however replace it with your own tool with the same
              name.
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
              This tool dosn't contain any code. It might be a taskyon-internal tool, an external
              tool defined on a parent webpage or from an MCP server.
              <q-btn
                label="Add tool code"
                :icon="matAdd"
                @click="() => (toolDraft.code = freshTool.code)"
              />
            </div>
          </q-tab-panel>
          <q-tab-panel name="configure">
            <ObjectTreeView :model-value="toolDraft" :schema="toolJsonSchema" />
          </q-tab-panel>
          <q-tab-panel name="definition" class="column">
            <JsonInput v-model="toolDraft" filled auto-save />
          </q-tab-panel>
        </q-tab-panels>
      </div>
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
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from 'vue'
import ObjectTreeView from 'src/components/ObjectTreeView.vue'
import UnderConstructionHint from 'src/components/UnderConstructionHint.vue'
import { matAdd, matContentCopy, matSave, matSearch } from '@quasar/extras/material-icons'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { asyncComputed } from 'src/modules/vueUtils'
import { craeteToolJsonSchema } from '../../../packages/taskyon/src/core/tools'
import {
  mdiCodeJson,
  mdiFormTextbox,
  mdiFunctionVariant,
  mdiKeyChain,
  mdiLanguageJavascript,
  mdiMagicStaff,
  mdiToolbox,
} from '@quasar/extras/mdi-v6'
import JsonInput from 'src/components/JsonInput.vue'
import { copyToClipboard } from 'quasar'
import TaskChainPublishDialog from 'src/components/taskyon/TaskChainPublishDialog.vue'
import { ToolBase } from '@taskyon/taskyon'
import type { InternalTool } from '@taskyon/taskyon'
import type { partialTaskDraft, TaskNode } from '@taskyon/taskyon'
import { createTaskNode } from 'src/modules/taskyon/taskManager'

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
const toolNames = computed(() => Object.keys(tystate.allTools))
const freshTool = {
  name: '',
  description: '',
  parameters: {},
  code: `(param_obj, {taskChain, setSecret, getSecret, toolId}) => {
  console.log('calling with params:', param_obj, toolId)
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

const allTools = asyncComputed(async () => {
  const ty = await tystate.taskyon
  const tools = await ty.updateToolDefinitions()
  return tools
}, undefined)

const alphabeticalTools = computed(() => {
  return allTools.value
    ? Object.values(allTools.value).sort((a, b) => a.name.localeCompare(b.name))
    : undefined
})

const selectedTool = asyncComputed<InternalTool | undefined>(
  async () => {
    const ty = await tystate.taskyon
    if (name) {
      const { tool } = await ty.getToolDefinition(name)
      if (tool) return tool
      // otherwise check if name is actually a task id...
      const toolDefTask = await ty.getTask(name)
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

const preliminaryTaskNode = asyncComputed<TaskNode | undefined>(async () => {
  try {
    return await createTaskNode({
      role: 'user',
      content: {
        type: 'tooldefinition',
        // we are doing this to 1. make sure its json parsable and 2. create a copy of the current tool...
        data: JSON.parse(JSON.stringify(toolDraft.value)),
      },
    })
  } catch (error) {
    console.log('could not create tasknode:', error)
  }
}, undefined)

async function addNewTask(task: partialTaskDraft) {
  const ty = await tystate.taskyon
  const newTask = await ty.addPartialTask2Tree(task)
  void router.push({
    params: { name: newTask.id },
  })
}
</script>
