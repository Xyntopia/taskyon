<template>
  <q-page class="q-pa-md">
    <q-card class="q-ma-md">
      <q-btn flat label="status" @click="showStatus = true">
        <q-dialog v-model="showStatus">
          <q-card>
            <Libp2pStatus :p2p="p2p" />
          </q-card>
        </q-dialog>
      </q-btn>
      <div>chat:</div>
      <SimpleChatView
        :selected-thread="[]"
        :show-task="() => true"
        :is-processing="() => false"
        :show-ids="false"
        :show-all-tasks="false"
      />
      <div v-for="msg in msgs" :key="msg.msgId">
        <div>{{ msg.peerId }}:</div>
        <div>{{ msg.msg }}</div>
      </div>
      <CreateNewTask
        :file-attachments="[]"
        class="col q-pa-xs create-new-task"
        min-mode
        style="max-width: 48rem"
        p2p-chat
        @add-tasks="addTasks"
      />
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import type { ChatMessage, partialTaskDraft } from '@taskyon/taskyon'
import { getActiveP2pNode } from '@taskyon/taskyon'
import Libp2pStatus from 'components/taskyon/Libp2pStatus.vue'
import CreateNewTask from 'src/components/taskyon/CreateNewTask.vue'
import SimpleChatView from 'src/components/taskyon/SimpleChatView.vue'
import { safeYamlDump } from 'src/modules/yamlUtils'
import { onMounted, ref } from 'vue'

const showStatus = ref(false)
const msgs = ref<ChatMessage[]>([])
const p2p = getActiveP2pNode()

p2p.messageStream.subscribe((msg) => {
  msgs.value.push(msg)
})

// Methods
const output = ref('')
const addToOutput = (message: string) => {
  const timestamp = new Date().toISOString()
  output.value += `[${timestamp}] ${message}\n`
}
p2p.activityStream.subscribe((msg) => {
  addToOutput(safeYamlDump(msg))
})

async function addTasks(taskChain: partialTaskDraft[]) {
  for (const t of taskChain) {
    if (t.content.type === 'message') {
      console.log('sending to public chat:', t)
      await p2p.sendPublicMessage(t.content.data)
    }
  }
}

onMounted(() => {
  void p2p.start()
})
</script>
