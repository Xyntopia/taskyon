<template>
  <q-page class="q-pa-md">
    <q-card class="q-ma-md">
      <q-card-section>
        <div class="text-h4 text-primary q-mb-md">WebRTC Connectivity with js-libp2p</div>

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
          Address: {{ peerId }}
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
          <q-expansion-item>
            {{ state }}
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
            <!--
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
              -->
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
</template>

<script setup lang="ts">
import { startLibp2p } from '@taskyon/taskyon'
import { asyncComputed } from 'src/modules/vueUtils'
import { safeYamlDump } from 'src/modules/yamlUtils'
import { computed, ref } from 'vue'
import {
  getAddresses,
  getPeerDetails,
  getPeerTypes,
} from '../../../packages/taskyon/src/p2p/p2putils'

const libp2pPromise = startLibp2p()
const nw = asyncComputed(async () => libp2pPromise, undefined)

// Reactive data
const multiaddrInput = ref('')
const output = ref('')
const state = computed(() => {
  return safeYamlDump(nw.value)
}, undefined)

const peerId = computed(() => nw.value?.peerId.toString())

const info = computed(() => {
  const node = nw.value
  if (node) {
    return {
      peerCount: node.getConnections().length,
      peerTypes: getPeerTypes(node),
      nodeAddressCount: node.getMultiaddrs().length,
      nodeAddresses: getAddresses(node),
      nodePeerDetails: getPeerDetails(node),
    }
  } else return undefined
})

// Methods
/*const enableLogging = (enable: boolean) => {
  // Implement libp2p logging enable logic
  nw.state.value?.enableLogging(enable)
  addToOutput(`Logging enabled: ${enable}`)
}*/

/*const connectToPeer = async (addr: string) => {
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
}*/

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
