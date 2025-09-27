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
      <q-btn label="send" @click="p2p.sendPublicMessage(`${new Date().toLocaleDateString()}`)" />
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { getActiveP2pNode } from '@taskyon/taskyon'
import Libp2pStatus from 'components/taskyon/Libp2pStatus.vue'
import SimpleChatView from 'src/components/taskyon/SimpleChatView.vue'
import { safeYamlDump } from 'src/modules/yamlUtils'
import { onMounted, ref } from 'vue'

const showStatus = ref(false)

const p2p = getActiveP2pNode()

// Methods
const output = ref('')
const addToOutput = (message: string) => {
  const timestamp = new Date().toISOString()
  output.value += `[${timestamp}] ${message}\n`
}
p2p.activityStream.subscribe((msg) => {
  addToOutput(safeYamlDump(msg))
})

onMounted(() => {
  void p2p.start()
})
</script>
