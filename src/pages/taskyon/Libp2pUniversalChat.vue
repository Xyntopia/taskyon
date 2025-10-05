<template>
  <q-page class="q-pa-md q-gutter-sm">
    <q-card>
      <q-toggle v-model="testWUniversalConnectivity" label="test w universal connectivity app" />
      <InfoDialog
        info-text="Taskyon can communicate with this app:
[github/libp2p/universal-connectivity](https://github.com/libp2p/universal-connectivity).

And by using the toggle, you can communicate with this app here: this example comes from
here: [universal-connectivity](https://universal-connectivity.on-fleek.app/)"
      />
      <q-btn flat label="status" @click="showStatus = true">
        <q-dialog v-model="showStatus">
          <q-card>
            <Libp2pStatus :p2p="p2p" />
          </q-card>
        </q-dialog>
      </q-btn>
      <div>Peer ID: {{ peerID }}</div>
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
    </q-card>
    <CreateNewTask
      :file-attachments="[]"
      class="col q-pa-xs create-new-task"
      min-mode
      style="max-width: 48rem"
      p2p-chat
      @add-tasks="addTasks"
    />
  </q-page>
</template>

<script setup lang="ts">
import type { ChatMessage, partialTaskDraft } from '@taskyon/taskyon'
import { CHAT_TOPIC, createTaskNode, getActiveP2pNode, safeYamlDump } from '@taskyon/taskyon'
import Libp2pStatus from 'components/taskyon/Libp2pStatus.vue'
import InfoDialog from 'src/components/InfoDialog.vue'
import CreateNewTask from 'src/components/taskyon/CreateNewTask.vue'
import SimpleChatView from 'src/components/taskyon/SimpleChatView.vue'
import { syncRefsWithLocalStorage } from 'src/modules/saveState'
import { onMounted, ref, watch } from 'vue'

const showStatus = ref(false)
const peerID = ref('none')
const msgs = ref<ChatMessage[]>([])
const p2p = getActiveP2pNode()
const testWUniversalConnectivity = ref(false)
const taskyonUniversalChatTopic = ref('taskyon-simple-chat')

syncRefsWithLocalStorage('libp2pchat', { testWUniversalConnectivity, taskyonUniversalChatTopic })

watch(testWUniversalConnectivity, async (val) => {
  await p2p.start({ chatTopic: val ? CHAT_TOPIC : taskyonUniversalChatTopic.value })
})

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
    console.log('sending to public chat:', t)
    const tn = await createTaskNode(t)
    if (tn.content.type === 'message') {
      msgs.value.push({
        msgId: tn.id,
        msg: tn.content.data,
        fileObjectUrl: undefined,
        peerId: (await p2p.id()) ?? 'none',
        read: true,
        receivedAt: Date.now(),
      })
      await p2p.sendPublicMessage(tn.content.data)
    }
  }
}

onMounted(async () => {
  await p2p.start({
    chatTopic: testWUniversalConnectivity.value ? CHAT_TOPIC : taskyonUniversalChatTopic.value,
  })
  peerID.value = (await p2p.id()) || 'none'
})
</script>
