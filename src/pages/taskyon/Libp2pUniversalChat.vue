<template>
  <q-page class="q-pa-md">
    <q-card class="q-ma-md">
      <q-btn flat label="status" @click="showStatus = true">
        <q-dialog v-model="showStatus">
          <q-card>
            <Libp2pStatus />
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
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import type { P2pNodeInfo } from '@taskyon/taskyon'
import { getActiveP2pNode } from '@taskyon/taskyon'
import Libp2pStatus from 'components/taskyon/Libp2pStatus.vue'
import SimpleChatView from 'src/components/taskyon/SimpleChatView.vue'
import { safeYamlDump } from 'src/modules/yamlUtils'
import { ref } from 'vue'

const showStatus = ref(false)

const p2p = getActiveP2pNode()
const info = ref<Partial<P2pNodeInfo>>({})
p2p.stream.subscribe((infoUpdate) => {
  info.value = { ...info.value, ...infoUpdate }
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

// Lifecycle
/*onMounted(async () => {
  const n = await libp2pPromise
  await n.start()

  n.port.receive((m) => {
    console.log(m)
    addToOutput(safeYamlDump(m))
  })

  useIntervalFn(() => {
    nodeInfo.value = nw.state.value?.info()
    //addToOutput('.$')
  }, 5000)
})*/
</script>
