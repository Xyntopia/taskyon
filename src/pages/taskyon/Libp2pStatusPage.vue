<template>
  <q-page class="q-pa-md">
    <q-card class="q-ma-md">
      <div>
        this example comes from here:
        <a
          href="https://github.com/libp2p/universal-connectivity"
          target="_blank"
          rel="noopener noreferrer"
        >
          libp2p/universal-connectivity
        </a>
        <a
          href="https://universal-connectivity.on-fleek.app/"
          target="_blank"
          rel="noopener noreferrer"
          >demo</a
        >
      </div>
      <q-card-section>
        <div class="text-h4 text-primary q-mb-md">WebRTC Connectivity with js-libp2p</div>
        <q-btn flat label="connect" @click="p2p.start()" />

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
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import type { Connection, PeerId } from '@libp2p/interface'
import { multiaddr } from '@multiformats/multiaddr'
import { createStream, startLibp2p } from '@taskyon/taskyon'
import { safeYamlDump } from 'src/modules/yamlUtils'
import { ref } from 'vue'
import { CHAT_TOPIC } from '../../../packages/taskyon/src/p2p/constants'
import { log } from '../../../packages/taskyon/src/p2p/libp2p'
import {
  getAddresses,
  getPeerDetails,
  getPeerTypes,
} from '../../../packages/taskyon/src/p2p/p2putils'

type P2pNodeInfo = {
  id: string
  peerCount: number
  peerTypes: ReturnType<typeof getPeerTypes>
  nodeAddressCount: number
  nodeAddresses: string[]
  nodePeerDetails: ReturnType<typeof getPeerDetails>
  connections: Connection[]
  subscribers: PeerId[]
}

type P2PMessage = {
  type: 'log'
  message: unknown
  topic?: string
}

const createNode = () => {
  let libp2pP: ReturnType<typeof startLibp2p> | null = null
  let info: Partial<P2pNodeInfo> = {}
  const { emit, stream } = createStream<Partial<P2pNodeInfo>>()
  const activityStream = createStream<P2PMessage>()
  const getPeerId = async () => (await libp2pP)?.peerId.toString()

  const updateInfo = (newInfo: Partial<P2pNodeInfo>) => {
    info = { ...info, ...newInfo }
    emit(info)
  }

  const init = async () => {
    libp2pP = startLibp2p()
    const n = await libp2pP
    void getPeerId().then((id) => {
      if (id) info.id = id
    })

    const syncInfo = () =>
      updateInfo({
        peerCount: n.getConnections().length,
        peerTypes: getPeerTypes(n),
        nodeAddressCount: n.getMultiaddrs().length,
        nodeAddresses: getAddresses(n),
        nodePeerDetails: getPeerDetails(n),
      })
    syncInfo()

    const onConnection = () => {
      updateInfo({ connections: n.getConnections() })
      syncInfo()
    }
    onConnection()
    const onSubscriptionChange = () => {
      updateInfo({ subscribers: n.services.pubsub.getSubscribers(CHAT_TOPIC) })
      syncInfo()
    }
    onSubscriptionChange()

    n.addEventListener('connection:open', onConnection)
    n.addEventListener('connection:close', onConnection)
    n.addEventListener('self:peer:update', ({ detail: { peer } }) => {
      activityStream.emit({ type: 'log', message: `peer updated: ${peer.id.toString()}` })
      updateInfo({ peerTypes: getPeerTypes(n), nodePeerDetails: getPeerDetails(n) })
    })
    n.addEventListener('peer:discovery', (event) => {
      const peer = event.detail
      activityStream.emit({ type: 'log', message: `discovered peer: ${peer.id.toString()}` })
      updateInfo({ peerCount: n.getConnections().length, peerTypes: getPeerTypes(n) })
    })
    n.services.pubsub.addEventListener('subscription-change', onSubscriptionChange)

    /*useEffect(() => {
    const init = async () => {
      if (await libp2p.peerStore.has(peer)) {
        const p = await libp2p.peerStore.get(peer)
        if (p.protocols.length > 0) {
          setIdentified(true)
        }
      }
    }*/
  }

  /*export const getFormattedConnections = (connections: Connection[]) =>
    connections.map((conn) => ({
      peerId: conn.remotePeer,
      protocols: [...new Set(conn.remoteAddr.protoNames())],
    }))*/

  return {
    init,
    id: getPeerId,
    start: async () => {
      await init()
      activityStream.emit({ type: 'log', message: `Peer started ${await getPeerId()}` })
    },
    stream,
    activityStream: activityStream.stream,
    connectToPeer: async (addr: string) => {
      const maddr = multiaddr(addr)
      log(`dialling: %a`, multiaddr.toString())
      // Implement peer connection logic
      let connection
      try {
        const p2p = await libp2pP
        if (!p2p) return
        connection = await p2p?.dial(maddr)
        if (connection)
          log(
            'connected to %p on %a',
            connection.remotePeer.toString(),
            connection.remoteAddr.toString(),
          )
        activityStream.emit({
          type: 'log',
          message: `Connected to: ${safeYamlDump(connection)}`,
          topic: CHAT_TOPIC,
        })
        updateInfo({ connections: p2p.getConnections() })
        //connection = await nw.state.value?.connectWith(addr)
      } catch (e) {
        console.error(e)
        connection = 'error on connection'
      }
    },
  }
}

const p2p = createNode()
const info = ref<Partial<P2pNodeInfo>>({})
p2p.stream.subscribe((infoUpdate) => {
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
