<template>
  <!--<q-drawer v-model="drawerOpen" show-if-above persistent behaviour="desktop" :width="250">
      <CreateNewTask class="q-pa-xs" expert-mode />
      <ObjectTreeView :model-value="functionArgs" />
    </q-drawer>-->
  <FadeAwayScrollPage padding class="column">
    <UnderConstructionHint />
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
      <q-btn flat dense label="Add MCP Tool" to="/mcp-tool-import" />
    </div>
    <q-separator class="q-my-md" />
    <div v-if="selectedTool || !name" class="col column q-gutter-sm">
      <div class="row">
        <q-btn flat dense label="Secrets" :icon="mdiKeyChain" to="/settings/secrets" />
        <div class="row items-center">
          <q-btn
            class="col-auto"
            :disable="!isValidTool"
            :color="isValidTool ? 'positive' : 'negative'"
            :icon="matSave"
            label="save tool"
            @click="saveTool"
            ><q-tooltip>{{
              isValidTool
                ? 'Install this immutable revision in the tool registry.'
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
      <DockView
        v-model:node="initialLayout"
        class="col"
        hide-tab-add
        hide-tab-close
        :tab-icons="{
          code: mdiLanguageJavascript,
          configure: mdiFormTextbox,
          definition: mdiCodeJson,
          settings: matSettings,
        }"
      >
        <template #code>
          <div class="fit">
            <div v-if="toolDraft.code" class="column">
              <q-btn
                class="self-end"
                flat
                dense
                :icon="matContentCopy"
                label="copy as js string"
                @click="copyAsJsString(toolDraft.code)"
              />
              <CodeEditor v-model="toolDraft.code" language="javascript" />
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
          </div>
        </template>
        <template #configure>
          <ObjectView :model-value="toolDraft" :schema="toolJsonSchema" />
        </template>
        <template #definition>
          <div class="fit">
            <JsonInput v-model="toolDraft" class="fit" filled auto-save autogrow="false" />
          </div>
        </template>
        <template #settings>
          <div class="fit">
            Current tool settings. Every parameter of a tool can be given a default value here,
            which will be used if other values are not provided when the tool is called. This
            effectivly creates dynamic agent profiles for taskyon.
            <ObjectView
              v-model="toolSettings"
              :schema="selectedTool?.parameters"
              missing-mode="placeholders"
            />
          </div>
        </template>
      </DockView>
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
  </FadeAwayScrollPage>
</template>

<script setup lang="ts">
import { matAdd, matContentCopy, matSave, matSettings } from '@quasar/extras/material-icons'
import {
  mdiCodeJson,
  mdiFormTextbox,
  mdiFunctionVariant,
  mdiKeyChain,
  mdiLanguageJavascript,
  mdiMagicStaff,
  mdiToolbox,
} from '@quasar/extras/mdi-v6'
import type { DockNode } from '@taskyon/ui/components/dockLayout'
import DockView from '@taskyon/ui/components/DockView.vue'
import FadeAwayScrollPage from '@taskyon/ui/components/FadeAwayScrollPage.vue'
import JsonInput from '@taskyon/ui/components/varViews/JsonInput.vue'
import ObjectView from '@taskyon/ui/components/varViews/ObjectView.vue'
import { copyToClipboard } from '@taskyon/common/modules/utils'
import type { ToolBase as ToolBaseType } from '@taskyon/taskyon'
import { craeteToolJsonSchema, ToolBase } from '@taskyon/taskyon'
import UnderConstructionHint from '@taskyon/ui/components/UnderConstructionHint.vue'
import { asyncComputed } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const { name = undefined } = defineProps<{ name?: string }>()

const state = useAppStateStore()

const toolSettings = computed({
  get: () => (name ? state.toolchainProfiles.base[name] : undefined),
  set: (v) => {
    if (name && v) state.toolchainProfiles.base[name] = v
  },
})

const initialLayout = ref<DockNode>({
  id: 'root',
  type: 'container',
  direction: 'row',
  children: [
    {
      id: 'code',
      type: 'leaf',
      collapsed: false,
      views: ['code', 'configure', 'definition', 'settings'],
      activeViewIndex: 0,
      size: 100,
    },
  ],
})

const CodeEditor = defineAsyncComponent(
  () =>
    import(
      /* webpackPrefetch: true */
      /* webpackChunkName: "codemirror" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      '@taskyon/ui/components/CodeEditor.vue'
    ),
)

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

const alphabeticalTools = computed(() =>
  Object.values(tystate.allTools).sort((a, b) => a.name.localeCompare(b.name)),
)

const selectedTool = asyncComputed<ToolBaseType | undefined>(
  async () => {
    if (name) {
      const resolved = await tystate.taskyonClient.tools.resolve({ name })
      if (resolved) return resolved.tool
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

async function saveTool() {
  if (!isValidTool.value) return
  const tool = ToolBase.parse(JSON.parse(JSON.stringify(toolDraft.value)))
  const identity = await (await tystate.taskyon).installTool(tool)
  void router.push({ params: { name: identity.name } })
}
</script>
