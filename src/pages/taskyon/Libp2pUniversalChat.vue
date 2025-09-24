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
          <q-expansion-item label="connections" expand-separator>
            <div class="overflow-auto">
              <q-list>
                <q-item v-for="c in connections" :key="c.id">
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
                <q-item v-for="s in subscribers" :key="s.toString()">
                  {{ s.toString() }}
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
</template>

<script setup lang="ts">
import type { PeerId } from '@libp2p/interface'
import { multiaddr } from '@multiformats/multiaddr'
import { startLibp2p } from '@taskyon/taskyon'
import type { Libp2p } from 'libp2p'
import { asyncComputed } from 'src/modules/vueUtils'
import { safeYamlDump } from 'src/modules/yamlUtils'
import { computed, ref } from 'vue'
import { CHAT_TOPIC } from '../../../packages/taskyon/src/p2p/constants'
import { log } from '../../../packages/taskyon/src/p2p/libp2p'
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

const useP2pInfo = () => {
  const node = nw.value
  let initialInfo: {
    peerCount: number
    peerTypes: ReturnType<typeof getPeerTypes>
    nodeAddressCount: number
    nodeAddresses: string[]
    nodePeerDetails: ReturnType<typeof getPeerDetails>
  }
  if (node) {
    initialInfo = {
      peerCount: node.getConnections().length,
      peerTypes: getPeerTypes(node),
      nodeAddressCount: node.getMultiaddrs().length,
      nodeAddresses: getAddresses(node),
      nodePeerDetails: getPeerDetails(node),
    }
  } else return undefined

  /*useEffect(() => {
    const init = async () => {
      if (await libp2p.peerStore.has(peer)) {
        const p = await libp2p.peerStore.get(peer)
        if (p.protocols.length > 0) {
          setIdentified(true)
        }
      }
    }

    init()
  }, [libp2p.peerStore, peer])*/

  const info = ref(initialInfo)
  return info
}

const info = useP2pInfo()

const connections = ref<ReturnType<Libp2p['getConnections']>>([])
const subscribers = ref<PeerId[]>([])

void libp2pPromise.then((n) => {
  const onConnection = () => {
    connections.value = n.getConnections()
  }
  onConnection()
  n.addEventListener('connection:open', onConnection)
  n.addEventListener('connection:close', onConnection)

  const onSubscriptionChange = () => {
    subscribers.value = n.services.pubsub.getSubscribers(CHAT_TOPIC)
  }
  n.services.pubsub.addEventListener('subscription-change', onSubscriptionChange)
})

// Methods
const connecting = ref(false)
const connectToPeer = async (addr: string) => {
  const maddr = multiaddr(addr)
  log(`dialling: %a`, multiaddr.toString())
  // Implement peer connection logic
  let connection
  connecting.value = true
  try {
    connection = await nw.value?.dial(maddr)
    if (connection)
      log(
        'connected to %p on %a',
        connection.remotePeer.toString(),
        connection.remoteAddr.toString(),
      )
    //connection = await nw.state.value?.connectWith(addr)
  } catch (e) {
    console.error(e)
    connection = 'error on connection'
  }
  console.log('connected...', connection)
  connecting.value = false
}

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
