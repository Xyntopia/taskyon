<template>
  <!--Task-->
  <TaskField
    v-if="task.content.type === 'files'"
    :task="task"
    :icon="mdiFileDocument"
    icon-color="info"
    :show-meta="showMeta"
  >
    <FileBrowser
      v-if="getFile"
      :file-mappings="fileMappings"
      :expert-mode="state.appConfiguration.expertMode"
      preview
      :preview-size="100"
      :get-file="getFile"
    />
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'return'"
    :task="task"
    :icon="matPause"
    icon-color="info"
    :show-meta="showMeta"
  >
    {{ task.content.data }}
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'functioncall'"
    :task="task"
    :show-meta="showMeta"
    short
  >
    <template #header>
      <div
        :class="
          nextTask?.content.type === 'error'
            ? 'text-red'
            : nextTask?.content.type === 'toolresult'
              ? 'text-green'
              : 'text-info'
        "
      >
        <div class="row no-wrap q-gutter-sm items-center">
          <q-spinner-orbit v-if="isWorking" size="2em"></q-spinner-orbit>
          <q-icon :name="matCalculate" size="1.5em"></q-icon>
          <div class="ellipsis">{{ task.content.data.name }}</div>
          <q-btn
            v-if="state.appConfiguration.expertMode"
            flat
            size="sm"
            :icon="matBuild"
            :to="`/tool/${task.content.data.name}`"
          />
        </div>
      </div>
    </template>
    <div class="text-bold">arguments (yaml):</div>
    <div caption>
      <div class="scroll-area">
        {{ dump(task.content.data.arguments) }}
      </div>
    </div>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'toolresult'"
    :task="task"
    :show-meta="showMeta"
    short
  >
    <template #header>
      Result: {{ safeYamlDump(task.content.data).split(' ').slice(0, 10).join(' ') }}...
    </template>
    <div caption class="relative-position">
      <div class="scroll-area">
        {{ safeYamlDump(task.content.data) }}
      </div>
    </div>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'structured'"
    class="text-info"
    :task="task"
    :show-meta="showMeta"
    :icon="mdiHeadCog"
    short
  >
    <template #header> Analyze... </template>
    <p style="white-space: pre-wrap">
      {{ safeYamlDump(task.content.data) }}
    </p>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'tooldefinition'"
    :task="task"
    :icon="mdiTools"
    :show-meta="showMeta"
    short
  >
    <template #header> function: {{ task.content.data.name }} </template>
    <p style="white-space: pre-wrap">
      {{ task.content.data }}
    </p>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'message'"
    :task="task"
    :icon="task.role === 'system' ? mdiDesktopTower : undefined"
    icon-color="info"
    :show-meta="showMeta"
    :short="short"
  >
    <template #header> {{ task.content.data.split(' ').slice(0, 10).join(' ') }}... </template>
    <template #default="{ showTaskMenu }">
      <tyMarkdown
        v-if="state.taskWidgetState[task.id]?.markdownEnabled != false"
        no-line-numbers
        :src="task.content.data"
        :use-iframe="true"
        @iframe-ready="(el: HTMLIFrameElement) => onIframeMessage(el, task.id)"
        @if-longpress="showTaskMenu(true)"
        @if-click="showTaskMenu(false)"
      />
      <div v-else class="raw-markdown q-mb-md">
        {{ task.content.data }}
      </div>
    </template>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'error'"
    :task="task"
    :icon="matWarning"
    icon-color="negative"
    :show-meta="showMeta"
    short
  >
    <template #header>
      <tyMarkdown
        :src="`Error: ${humanizeError(task.content.data).split(' ').slice(0, 10).join(' ')}...`"
        no-line-numbers
        use-iframe
      />
    </template>
    <template #default="{ showTaskMenu }">
      <div class="text-negative">
        <tyMarkdown
          :src="humanizeError(task.content.data)"
          no-line-numbers
          use-iframe
          @if-longpress="showTaskMenu(true)"
          @if-click="showTaskMenu(false)"
        />
      </div>
    </template>
  </TaskField>
</template>

<script setup lang="ts">
import { matBuild, matCalculate, matPause, matWarning } from '@quasar/extras/material-icons'
import { mdiDesktopTower, mdiFileDocument, mdiHeadCog, mdiTools } from '@quasar/extras/mdi-v6'
import type { TaskNode } from '@taskyon/taskyon'
import { dump } from 'js-yaml'
import type { FileMapping } from 'src/modules/taskyon/taskManager'
import { humanizeError } from 'src/modules/utils'
import { safeYamlDump } from 'src/modules/yamlUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { ref } from 'vue'
import tyMarkdown from '../tyMarkdown.vue'
import FileBrowser from './FileBrowser.vue'
import TaskField from './TaskField.vue'

const { task } = defineProps<{
  task: TaskNode
  nextTask?: TaskNode | undefined
  isWorking?: boolean
  short?: boolean
  showMeta?: boolean
}>()

const tystate = useTaskyonStore()

const state = useAppStateStore()
const fileMappings = ref<FileMapping[]>([])
async function getFile(uuid: string) {
  console.log('load image', uuid)
  return (await tystate.taskyon).getOpfsUploadedFile(uuid)
}

const onIframeMessage = (el: HTMLIFrameElement, id: string) => {
  void tystate.connectMessageIframe(id, el)
}

if (task.content.type === 'files') {
  console.log('get uploaded files')
  void (async (fileUuids: string[]) => {
    const ty = await tystate.taskyon
    const fm = await Promise.all(fileUuids.map((uuid) => ty.getFileMappingByUuid(uuid)))
    fileMappings.value = fm.filter((x) => x != null)
    /*fileMappings.value = fm.map((x) => {
      const newfm = { ...x, xinfo: { uuid: x?.uuid } };
      return newfm;
    });*/
  })(task.content.data)
}
</script>
