<template>
  <q-page class="q-pa-sm">
    <div class="row q-col-gutter-sm">
      <div class="col-12 col-md-4 col-lg-3">
        <div class="q-gutter-sm">
          <NetworkManager :controls="controls" :snapshot="snapshot" />

          <Libp2pStatus :status="snapshot" :busy="snapshot.state.busy" />

          <q-card flat bordered>
            <q-card-section class="q-pa-sm row items-center q-col-gutter-sm">
              <div class="col">
                <div class="text-subtitle2">Live Neighbors</div>
                <div class="text-caption text-grey-7">Current direct peers for this chatroom.</div>
              </div>
              <div class="col-auto">
                <q-chip square>{{ onlineNeighbors.length }}</q-chip>
              </div>
            </q-card-section>
            <q-separator />
            <q-list v-if="onlineNeighbors.length > 0" dense separator>
              <q-item v-for="neighbor in onlineNeighbors" :key="neighbor.peerId">
                <q-item-section>
                  <q-item-label>{{ shortId(neighbor.peerId) }}</q-item-label>
                  <q-item-label caption>
                    {{ neighbor.isRelay ? 'relay' : 'peer' }}
                    <span v-if="neighbor.lastRttMs !== undefined">
                      · {{ Math.round(neighbor.lastRttMs) }} ms
                    </span>
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
            <q-card-section v-else class="q-pa-sm text-caption text-grey-7">
              No live neighbors yet.
            </q-card-section>
          </q-card>

          <q-expansion-item
            dense
            :icon="matConstruction"
            label="Developer Actions"
            caption="Manual dialing and logs"
            header-class="bg-grey-2"
            expand-separator
          >
            <q-card flat bordered>
              <q-card-section class="q-pa-sm q-gutter-sm">
                <q-input
                  :model-value="snapshot.state.manualDialAddr"
                  label="Manual multiaddr"
                  outlined
                  dense
                  @update:model-value="(value) => controls.setManualDialAddr(String(value))"
                />
                <div class="row q-gutter-sm">
                  <q-btn
                    outline
                    color="primary"
                    label="Dial Relay"
                    :disable="snapshot.state.busy || !snapshot.runtime.nodeActive"
                    @click="controls.dialCurrentRelay()"
                  />
                  <q-btn
                    outline
                    color="primary"
                    label="Dial"
                    :disable="
                      snapshot.state.busy ||
                      !snapshot.runtime.nodeActive ||
                      !snapshot.state.manualDialAddr
                    "
                    @click="controls.dialAddress(snapshot.state.manualDialAddr)"
                  />
                  <q-btn flat label="Copy Logs" :disable="!snapshot.state.logs" @click="copyLogs" />
                  <q-btn
                    flat
                    color="negative"
                    label="Clear"
                    :disable="!snapshot.state.logs"
                    @click="controls.clearLogs()"
                  />
                </div>
              </q-card-section>
            </q-card>
          </q-expansion-item>
        </div>
      </div>

      <div class="col-12 col-md-8 col-lg-9">
        <q-card flat bordered>
          <q-card-section class="q-pa-sm row items-center q-col-gutter-sm">
            <div class="col">
              <div class="text-subtitle1">{{ activeNetworkName }}</div>
              <div class="text-caption text-grey-7">
                {{ currentMessages.length }} message(s) · {{ onlineNeighbors.length }} live
                neighbor(s)
              </div>
            </div>
            <ProceduralSpaceshipIdenticon
              v-if="snapshot.nodeId"
              :storage-client="taskyon.storageClient"
              :seed-text="snapshot.nodeId"
              class="col-auto"
            />
            <div class="col-auto">
              <q-chip square>{{ shortId(snapshot.nodeId || 'offline') }}</q-chip>
            </div>
          </q-card-section>
          <q-separator />

          <q-scroll-area style="height: calc(100vh - 250px)">
            <q-list separator>
              <q-item v-for="message in currentMessages" :key="message.id">
                <q-item-section avatar>
                  <ProceduralSpaceshipIdenticon
                    :storage-client="taskyon.storageClient"
                    :seed-text="message.senderPeerId"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ message.body }}</q-item-label>
                  <q-item-label caption>
                    {{ shortId(message.senderPeerId) }} · {{ message.createdAt }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
            <div v-if="currentMessages.length === 0" class="q-pa-md text-caption text-grey-7">
              No chat messages yet. Start discovery, join the same subnetwork on another node, and
              send a message.
            </div>
          </q-scroll-area>

          <q-separator />
          <q-card-section class="q-pa-sm">
            <q-form class="row q-col-gutter-sm items-end" @submit.prevent="sendChatMessage">
              <div class="col">
                <q-input
                  v-model="draftMessage"
                  label="Message to the active subnetwork"
                  autogrow
                  outlined
                  dense
                />
              </div>
              <div class="col-auto">
                <q-btn
                  color="primary"
                  label="Send"
                  type="submit"
                  :disable="!snapshot.runtime.nodeActive || !draftMessage.trim()"
                />
              </div>
            </q-form>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { matConstruction } from '@quasar/extras/material-icons'
import {
  createP2pBus,
  type NeighborHealth,
  type P2pBusCommand,
  type P2pBusEvent,
  type P2pChatMessage,
  type P2pManagerSnapshot,
} from '@taskyon/p2p-core'
import ProceduralSpaceshipIdenticon from '@taskyon/spaceships/ProceduralSpaceshipIdenticon.vue'
import { copyToClipboard } from 'quasar'
import Libp2pStatus from 'src/components/taskyon/Libp2pStatus.vue'
import NetworkManager from 'src/components/taskyon/NetworkManager.vue'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

const p2pBus = createP2pBus()
const taskyon = useTaskyonStore()
const snapshot = shallowRef<P2pManagerSnapshot>(p2pBus.manager.getSnapshot())
const chatMessages = ref<P2pChatMessage[]>([])
const draftMessage = ref('')
let unsubscribe: (() => void) | null = null

const activeNetworkName = computed(
  () =>
    snapshot.value.state.subnetworks.find(
      (network) => network.id === snapshot.value.state.activeSubnetworkId,
    )?.name ?? 'No active subnetwork',
)

const currentMessages = computed(() =>
  chatMessages.value.filter(
    (message) => message.subnetworkId === snapshot.value.state.activeSubnetworkId,
  ),
)

const onlineNeighbors = computed(() =>
  snapshot.value.state.neighborHealth.filter(
    (neighbor: NeighborHealth) => neighbor.status === 'online' && !neighbor.isRelay,
  ),
)

function sendCommand(command: P2pBusCommand) {
  p2pBus.port.send(command)
}

const controls = {
  setActiveSubnetwork: (id: string) => sendCommand({ type: 'p2p.setActiveSubnetwork', id }),
  updateSubnetwork: (
    id: string,
    patch: Partial<{ name: string; secret: string; relayAddrs: string[] }>,
  ) => {
    sendCommand({ type: 'p2p.updateSubnetwork', id, patch })
  },
  joinFixtureNetwork: () => sendCommand({ type: 'p2p.joinFixtureNetwork' }),
  start: () => sendCommand({ type: 'p2p.start' }),
  restart: () => sendCommand({ type: 'p2p.restart' }),
  stop: () => sendCommand({ type: 'p2p.stop' }),
  addSubnetwork: (input?: { name?: string; relayAddrs?: string[] }) => {
    sendCommand(input ? { type: 'p2p.addSubnetwork', input } : { type: 'p2p.addSubnetwork' })
  },
  setVerboseLogsEnabled: (enabled: boolean) =>
    sendCommand({ type: 'p2p.setVerboseLogsEnabled', enabled }),
  setManualDialAddr: (addr: string) => sendCommand({ type: 'p2p.setManualDialAddr', addr }),
  dialCurrentRelay: () => sendCommand({ type: 'p2p.dialCurrentRelay' }),
  dialAddress: (addr: string) => sendCommand({ type: 'p2p.dialAddress', addr }),
  clearLogs: () => sendCommand({ type: 'p2p.clearLogs' }),
}

function shortId(value: string) {
  if (!value) return 'offline'
  if (value.length <= 16) return value
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

function handleBusEvent(event: P2pBusEvent) {
  switch (event.type) {
    case 'p2p.state':
      snapshot.value = event.snapshot
      break
    case 'p2p.chat.message': {
      const existingIndex = chatMessages.value.findIndex((entry) => entry.id === event.message.id)
      if (existingIndex >= 0) chatMessages.value.splice(existingIndex, 1, event.message)
      else chatMessages.value.push(event.message)
      break
    }
    default:
      break
  }
}

function sendChatMessage() {
  const body = draftMessage.value.trim()
  if (!body) return
  sendCommand({
    type: 'p2p.chat.send',
    body,
    subnetworkId: snapshot.value.state.activeSubnetworkId,
  })
  draftMessage.value = ''
}

async function copyLogs() {
  await copyToClipboard(snapshot.value.state.logs)
}

onMounted(() => {
  unsubscribe = p2pBus.port.receive(handleBusEvent)
})

onBeforeUnmount(async () => {
  unsubscribe?.()
  p2pBus.destroy()
  await p2pBus.manager.stop()
})
</script>
