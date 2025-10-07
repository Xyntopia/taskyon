<template>
  <q-card-section>
    <div class="text-h4 text-primary q-mb-md">WebRTC Connectivity with js-libp2p</div>
    <!---btn flat label="connect" @click="p2p.start({})" />-->
    <!-- Statistics Section -->
    <!--TODO: <q-list dense class="q-mb-md">
          <q-item>
            <q-item-section>
              <q-item-label>
                Opened sessions in the last {{ openedPerUnit }}s: {{ openedPerMinute }}
              </q-item-label>
            </q-item-section>
          </q-item>
          <q-item>
            <q-item-section>
              <q-item-label>
                Max opened connections per minute: {{ maxOpenedPerMinute }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>-->

    <!-- Node Section -->
    <div class="q-mb-lg">
      <div class="text-h5 text-primary q-mb-sm">Node Info</div>
      Address: {{ info.id }}
      <div>
        peer types:
        <pre>{{ safeYamlDump(info?.peerTypes) }}</pre>
      </div>
      <q-expansion-item label="addresses of this node" expand-separator>
        <div class="overflow-auto" style="max-height: 300px">
          <q-list>
            <q-item v-for="addr in info?.nodeAddresses" :key="addr">
              {{ addr }}
            </q-item>
          </q-list>
        </div>
      </q-expansion-item>
      <q-expansion-item label="peers" expand-separator>
        <div class="overflow-auto">
          <q-list>
            <q-item v-for="peer in info?.nodePeerDetails" :key="peer.peerConnections[0]!">
              <q-item-section side>{{ peer.nodeType[0] }}</q-item-section>
              <q-item-section>{{ peer.peerConnections }}</q-item-section>
            </q-item>
          </q-list>
        </div>
      </q-expansion-item>
      <q-expansion-item label="connections" expand-separator>
        <div class="overflow-auto">
          <q-list>
            <q-item v-for="c in info.connections" :key="c.id">
              {{ c.id }}
              {{ c.remotePeer.toString() }}
              {{ c.remoteAddr.toString() }}
            </q-item>
          </q-list>
        </div>
      </q-expansion-item>
      <q-expansion-item label="subscribers" expand-separator>
        <div class="overflow-auto">
          <q-list>
            <q-item v-for="s in info.subscribers" :key="s.toString()">
              {{ s.toString() }}
            </q-item>
          </q-list>
        </div>
      </q-expansion-item>
    </div>

    <!-- Peers Section -->
    <div class="q-mb-lg">
      <div class="text-h5 text-primary q-mb-sm">Peers</div>
      <div class="row q-gutter-md items-center q-mb-md">
        <div class="col">
          <q-input
            v-model="multiaddrInput"
            label="Multiaddr"
            placeholder="/ip4/..."
            outlined
            dense
          />
        </div>
        <div class="col-auto">
          <q-btn
            color="positive"
            label="Connect"
            :loading="connecting"
            @click="connectToPeer(multiaddrInput)"
          />
          <q-btn
            color="positive"
            label="Connect To local relay"
            :loading="connecting"
            @click="connectToPeer('/ip4/127.0.0.1/tcp/9111/ws')"
          />
        </div>
      </div>
    </div>

    <!-- Output Section -->
    <div class="text-h5 text-primary q-mb-sm">Output</div>
    <q-scroll-area style="height: 300px">
      <pre class="q-pa-md rounded-borders text-caption">{{ output }}</pre>
    </q-scroll-area>
  </q-card-section>
</template>

<script setup lang="ts">
import { type getActiveP2pNode, type P2pNodeInfo } from '@taskyon/taskyon'
import { safeYamlDump } from '../../../packages/taskyon/src/utils/yamlUtils'
import { ref } from 'vue'

const { p2p } = defineProps<{ p2p: ReturnType<typeof getActiveP2pNode> }>()

const info = ref<Partial<P2pNodeInfo>>(p2p.getInfo())
p2p.stream((infoUpdate) => {
  console.log('infoUpdate', infoUpdate)
  info.value = { ...info.value, ...infoUpdate }
})

// Methods
const connecting = ref(false)
const multiaddrInput = ref('')
const connectToPeer = async (addr: string) => {
  connecting.value = true
  await p2p.connectToPeer(addr)
  connecting.value = false
}
const output = ref('')
const addToOutput = (message: string) => {
  const timestamp = new Date().toISOString()
  output.value += `[${timestamp}] ${message}\n`
}
p2p.activityStream((msg) => {
  console.log('activityStream msg', msg)
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
