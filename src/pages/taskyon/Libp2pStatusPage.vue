<template>
  <q-layout view="hHh lpR lFr">
    <TaskyonHeader btn-size="md" />
    <q-page-container>
      <q-page class="q-pa-md">
        <q-card class="q-ma-md">
          <q-card-section>
            <div class="text-h4 text-primary q-mb-md">WebRTC Connectivity with js-libp2p</div>
            <div class="q-gutter-sm">
              <q-btn
                color="primary"
                size="sm"
                label="Enable libp2p Logging"
                @click="enableLogging(true)"
              />
              <q-btn
                color="negative"
                size="sm"
                label="Disable libp2p Logging"
                @click="enableLogging(false)"
              />
            </div>

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
              Address: {{ nw.state.value?.getPeerId() }}
              <div>
                peer types:
                <pre>{{ safeYamlDump(nodeInfo?.peerTypes) }}</pre>
              </div>
              <q-expansion-item label="addresses of this node" expand-separator>
                <div class="overflow-auto" style="max-height: 300px">
                  <q-list>
                    <q-item v-for="addr in nodeInfo?.nodeAddresses" :key="addr">
                      {{ addr }}
                    </q-item>
                  </q-list>
                </div>
              </q-expansion-item>
              <q-expansion-item label="peers" expand-separator>
                <div class="overflow-auto">
                  <q-list>
                    <q-item
                      v-for="peer in nodeInfo?.nodePeerDetails"
                      :key="peer.peerConnections[0]!"
                    >
                      <q-item-section side>{{ peer.nodeType[0] }}</q-item-section>
                      <q-item-section>{{ peer.peerConnections }}</q-item-section>
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
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { createPeerNetwork } from '@taskyon/taskyon'
import { useAsyncState, useIntervalFn } from '@vueuse/core'
import TaskyonHeader from 'src/components/taskyon/TaskyonHeader.vue'
import { safeYamlDump } from 'src/modules/yamlUtils'
import { ref, onMounted } from 'vue'
import type { NodeInfo } from '../../../packages/taskyon/src/p2p/libp2p.bk'

const nwpromise = createPeerNetwork()

const nw = useAsyncState(nwpromise, undefined)

// Reactive data
const multiaddrInput = ref('')
const output = ref('')
const nodeInfo = ref<NodeInfo>()
const connecting = ref(false)

// Methods
const enableLogging = (enable: boolean) => {
  // Implement libp2p logging enable logic
  nw.state.value?.enableLogging(enable)
  addToOutput(`Logging enabled: ${enable}`)
}

const connectToPeer = async (addr: string) => {
  // Implement peer connection logic
  addToOutput(`Attempting to connect to: ${addr}`)

  let connection
  connecting.value = true
  try {
    connection = await nw.state.value?.connectWith(addr)
  } catch (e) {
    console.error(e)
    connection = 'error on connection'
  }
  connecting.value = false

  addToOutput(`Connected to: ${safeYamlDump(connection)}`)
}

const addToOutput = (message: string) => {
  const timestamp = new Date().toISOString()
  output.value += `[${timestamp}] ${message}\n`
}

// Lifecycle
onMounted(async () => {
  const n = await nwpromise
  await n.start()

  n.port.receive((m) => {
    console.log(m)
    addToOutput(safeYamlDump(m))
  })

  useIntervalFn(() => {
    nodeInfo.value = nw.state.value?.info()
    //addToOutput('.$')
  }, 5000)
})
</script>
