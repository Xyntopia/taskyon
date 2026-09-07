<template>
  <q-page class="q-pa-md">
    <div v-if="confirmCreation" role="status">Creation is waiting</div>
    <q-btn label="Confirm creation" :disable="!confirmCreation" @click="confirmCreation?.()" />
    <q-btn label="Open tool example" @click="openExample" />
    <TaskChatWindow
      v-model:selected-task-id="selected"
      :client="client"
      :entry-node="undefined"
      status="ready"
      :all-tools="tools"
    />
  </q-page>
</template>

<script setup lang="ts">
import {
  createPortServer,
  createProtocolPort,
  createTaskyonClient,
  createTaskRecordReader,
  createStorageClient,
  createStorageProtocolServer,
  createMemoryStorageRecordBackend,
  taskyonStorageProtocol,
  type StorageRecordBackend,
  taskyonProtocol,
  type TaskNode,
  type ToolBase,
} from '@taskyon/taskyon/api'
import TaskChatWindow from '@taskyon/ui/components/taskyon/TaskChatWindow.vue'
import { onBeforeUnmount, ref, shallowRef } from 'vue'

const selected = ref<string>()
const confirmCreation = shallowRef<() => void>()
const tasks = new Map<string, TaskNode>()
const ports = createProtocolPort(taskyonProtocol)
const storagePorts = createProtocolPort(taskyonStorageProtocol)
const backends = new Map<string, StorageRecordBackend>()
const stopStorage = createStorageProtocolServer(
  storagePorts.y,
  {
    records: (namespace) => {
      const backend = backends.get(namespace) ?? createMemoryStorageRecordBackend()
      backends.set(namespace, backend)
      return backend
    },
  },
  { mode: 'trusted-local' },
)
const storage = createStorageClient(storagePorts.x, {
  namespacePrefix: 'chat-test',
  distribution: 'local-only',
})
const client = createTaskyonClient(ports.x, {
  taskSource: createTaskRecordReader(storage, 'fixture'),
})
const tools: Record<string, ToolBase> = {
  fixtureTool: {
    name: 'fixtureTool',
    description: 'Synthetic test tool',
    parameters: { type: 'object' },
  },
}
const stop = createPortServer(ports.y, taskyonProtocol, {
  task: {
    get: ({ id }) => tasks.get(id) ?? null,
    getIdChain: ({ id }) => client.taskModel.lineage(id).map((task) => task.id),
    createChain: async ({ tasks: drafts }) => {
      await new Promise<void>((resolve) => {
        confirmCreation.value = resolve
      })
      confirmCreation.value = undefined
      const stored = drafts.map(
        (draft, index): TaskNode => ({
          ...draft,
          id: `submitted-${index}`,
          ...(index ? { priorID: `submitted-${index - 1}` } : {}),
        }),
      )
      for (const task of stored) {
        tasks.set(task.id, task)
        ports.y.send({ type: 'taskCreated', task })
      }
      return { ids: stored.map((task) => task.id) }
    },
  },
})
ports.y.send({ type: 'taskyonReady' })
const openExample = () => {
  const example: TaskNode[] = [
    {
      id: 'fixture-call',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'fixtureTool', arguments: {} } },
    },
    {
      id: 'fixture-data',
      parentID: 'fixture-call',
      role: 'system',
      content: { type: 'toolresult', data: { answer: 42 } },
    },
    {
      id: 'fixture-summary',
      parentID: 'fixture-call',
      role: 'assistant',
      content: { type: 'message', data: 'A visible assistant summary' },
    },
  ]
  for (const task of example) {
    tasks.set(task.id, task)
    client.taskModel.ingest(task)
  }
  selected.value = 'fixture-call'
}
onBeforeUnmount(() => {
  confirmCreation.value?.()
  stop()
  stopStorage()
  client.dispose()
})
</script>
