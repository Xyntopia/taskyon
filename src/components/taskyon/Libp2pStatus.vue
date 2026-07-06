<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-col-gutter-sm q-pa-sm">
      <div class="col">
        <div class="text-subtitle1">Subnetwork Discovery</div>
        <div class="text-caption text-grey-7">
          Compact overview of the current browser libp2p discovery state.
        </div>
      </div>
      <div class="col-auto">
        <q-chip :color="busy ? 'warning' : 'positive'" text-color="white" square>
          {{ busy ? 'Updating' : 'Ready' }}
        </q-chip>
      </div>
      <div class="col-auto">
        <q-btn flat dense color="primary" label="State" @click="openDetail('fullState')" />
      </div>
    </q-card-section>

    <q-separator />

    <q-list separator dense>
      <q-item v-for="item in summaryItems" :key="item.id" clickable @click="openDetail(item.id)">
        <q-item-section avatar>
          <q-icon :name="item.icon" color="primary" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ item.label }}</q-item-label>
          <q-item-label caption>{{ item.caption }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-chip outline color="primary" square>
            {{ item.value }}
          </q-chip>
        </q-item-section>
      </q-item>
    </q-list>

    <q-dialog v-model="detailsDialogOpen" maximized>
      <q-card>
        <q-card-section class="row items-center q-col-gutter-sm q-pa-sm">
          <div class="col">
            <div class="text-h6">{{ activeDetail?.title ?? 'Details' }}</div>
            <div class="text-caption text-grey-7">
              {{ activeDetail?.caption ?? 'No detail selected.' }}
            </div>
          </div>
          <div class="col-auto">
            <q-btn v-close-popup flat round :icon="matClose" />
          </div>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <ObjectView
            :model-value="activeDetail?.data"
            read-only
            copy-object-btn
            enable-expert-mode
          />
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<script setup lang="ts">
import {
  matDeviceHub,
  matHub,
  matKey,
  matLink,
  matClose,
  matSubject,
  matTravelExplore,
} from '@quasar/extras/material-icons'
import type { P2pManagerSnapshot } from '@taskyon/p2p-core'
import ObjectView from '@taskyon/ui/components/varViews/ObjectView.vue'
import { computed, ref } from 'vue'

const { status, busy = false } = defineProps<{
  status: P2pManagerSnapshot
  busy?: boolean
}>()

const detailsDialogOpen = ref(false)
const activeDetailId = ref<string | null>(null)

const detailSections = computed(() => ({
  fullState: {
    title: 'Full Network State',
    caption: 'Complete functional p2p state snapshot, including subnetwork and action metadata.',
    data: status.state,
  },
  runtime: {
    title: 'Runtime',
    caption: 'Current browser discovery settings and runtime state.',
    data: status.runtime,
  },
  node: {
    title: 'Node',
    caption: 'Local node identity, addresses, and peer transport mix.',
    data: {
      nodeId: status.nodeId,
      nodeAddresses: status.nodeAddresses,
      peerTypes: status.peerTypes,
      peerDetails: status.peerDetails,
      relayAddresses: status.relayAddresses,
      subnetworkTokens: status.subnetworkTokens,
    },
  },
  discovery: {
    title: 'Discovery',
    caption: 'Subnet-matching peers discovered through the global discovery network.',
    data: {
      discoveredPeers: status.discoveredPeers,
      subscribers: status.subscribers,
      subnetworkTokens: status.subnetworkTokens,
    },
  },
  neighbors: {
    title: 'Immediate Neighbors',
    caption: 'Live neighbor health derived from current connections and active ping checks.',
    data: {
      neighborHealth: status.neighborHealth,
      connections: status.connections,
    },
  },
  connections: {
    title: 'Connections',
    caption: 'Active transport connections and current subscribers.',
    data: {
      connections: status.connections,
      subscribers: status.subscribers,
    },
  },
  logs: {
    title: 'Logs',
    caption: 'Captured browser-side libp2p activity and debug output.',
    data: {
      logs: status.logs,
    },
  },
}))

const onlineNeighbors = computed(
  () => status.neighborHealth.filter((neighbor) => neighbor.status === 'online').length,
)
const degradedNeighbors = computed(
  () => status.neighborHealth.filter((neighbor) => neighbor.status === 'degraded').length,
)

const summaryItems = computed(() => [
  {
    id: 'runtime',
    label: 'Node',
    caption: status.nodeId || 'No active node yet',
    value: status.nodeId ? 'active' : 'idle',
    icon: matHub,
  },
  {
    id: 'neighbors',
    label: 'Neighbors',
    caption: `${onlineNeighbors.value} online, ${degradedNeighbors.value} degraded, ${status.neighborHealth.length} tracked`,
    icon: matDeviceHub,
    value: String(onlineNeighbors.value),
  },
  {
    id: 'discovery',
    label: 'Discovered Members',
    caption: `${status.discoveredPeers.length} matching peer(s) seen for this subnetwork`,
    value: String(status.discoveredPeers.length),
    icon: matTravelExplore,
  },
  {
    id: 'connections',
    label: 'Connections',
    caption: `${status.connections.length} live transport connection(s)`,
    value: String(status.connections.length),
    icon: matLink,
  },
  {
    id: 'discovery',
    label: 'Discovery Tokens',
    caption: `${status.subnetworkTokens.length} opaque token(s) currently announced`,
    value: String(status.subnetworkTokens.length),
    icon: matKey,
  },
  {
    id: 'logs',
    label: 'Logs',
    caption: `${status.logs.trim() ? status.logs.trim().split('\n').length : 0} captured log line(s)`,
    value: status.logs.trim() ? 'ready' : 'empty',
    icon: matSubject,
  },
])

const activeDetail = computed(() =>
  activeDetailId.value
    ? detailSections.value[activeDetailId.value as keyof typeof detailSections.value]
    : null,
)

function openDetail(id: string) {
  activeDetailId.value = id
  detailsDialogOpen.value = true
}
</script>
