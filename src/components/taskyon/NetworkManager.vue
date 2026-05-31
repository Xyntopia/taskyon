<template>
  <q-card flat bordered>
    <q-card-section class="q-pa-sm q-gutter-sm">
      <div class="q-gutter-xs">
        <div>
          <div class="text-subtitle1">Network</div>
          <div class="text-caption text-grey-7">
            Switch subnetworks, update the current room, and control discovery.
          </div>
        </div>

        <q-select
          :model-value="snapshot.state.activeSubnetworkId"
          :options="networkOptions"
          emit-value
          map-options
          label="Subnetwork"
          outlined
          dense
          @update:model-value="(value) => controls.setActiveSubnetwork(String(value))"
        />

        <q-input
          :model-value="activeNetworkName"
          label="Subnetwork label"
          outlined
          dense
          @update:model-value="(value) => updateActiveNetwork({ name: String(value) })"
        />

        <q-input
          :model-value="activeNetworkSecret"
          :type="showSecret ? 'text' : 'password'"
          label="Subnetwork secret"
          outlined
          dense
          @update:model-value="(value) => updateActiveNetwork({ secret: String(value) })"
        >
          <template #append>
            <q-btn
              flat
              round
              :icon="showSecret ? matVisibilityOff : matVisibility"
              @click="showSecret = !showSecret"
            />
          </template>
        </q-input>

        <q-input
          :model-value="activeRelayAddr"
          label="Relay"
          outlined
          dense
          @update:model-value="(value) => updateActiveRelay(String(value))"
        />
      </div>

      <q-list bordered separator dense>
        <q-item>
          <q-item-section>
            <q-item-label>Current Network</q-item-label>
            <q-item-label caption>{{ activeNetworkName }}</q-item-label>
          </q-item-section>
        </q-item>
        <q-item>
          <q-item-section>
            <q-item-label>Discovery Token</q-item-label>
            <q-item-label caption class="ellipsis">
              {{ activeDiscoveryToken || 'not derived yet' }}
            </q-item-label>
          </q-item-section>
        </q-item>
        <q-item>
          <q-item-section>
            <q-item-label>Fixture Network</q-item-label>
            <q-item-label caption>
              {{ fixtureNetwork.name }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-btn flat dense color="primary" label="Join Test" @click="joinFixtureNetwork" />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card-section>

    <q-separator />

    <q-card-actions align="left" class="q-pa-sm">
      <q-btn color="primary" label="Start" :loading="busy" @click="controls.start()" />
      <q-btn outline color="primary" label="Restart" :disable="busy" @click="controls.restart()" />
      <q-btn flat color="negative" label="Stop" :disable="busy" @click="controls.stop()" />
      <q-btn flat color="primary" label="Add" :disable="busy" @click="addSubnetwork" />
      <q-toggle
        :model-value="snapshot.state.verboseLogsEnabled"
        label="Verbose"
        @update:model-value="(value) => controls.setVerboseLogsEnabled(!!value)"
      />
    </q-card-actions>

    <q-banner
      v-if="snapshot.state.errorMessage"
      dense
      rounded
      class="bg-negative text-white q-ma-md"
    >
      {{ snapshot.state.errorMessage }}
    </q-banner>
  </q-card>
</template>

<script setup lang="ts">
import { matVisibility, matVisibilityOff } from '@quasar/extras/material-icons'
import { computed, ref } from 'vue'
import { headlessBrowserDiscoveryTestNetwork, type P2pManagerSnapshot } from '@taskyon/p2p-core'

type NetworkControls = {
  setActiveSubnetwork: (id: string) => void
  updateSubnetwork: (
    id: string,
    patch: Partial<{ name: string; secret: string; relayAddrs: string[] }>,
  ) => Promise<void> | void
  joinFixtureNetwork: () => void
  start: () => void
  restart: () => void
  stop: () => void
  addSubnetwork: (input?: { name?: string; relayAddrs?: string[] }) => Promise<void> | void
  setVerboseLogsEnabled: (enabled: boolean) => void
}

const { controls, snapshot } = defineProps<{
  controls: NetworkControls
  snapshot: P2pManagerSnapshot
}>()

const showSecret = ref(false)

const fixtureNetwork = headlessBrowserDiscoveryTestNetwork

const networkOptions = computed(() =>
  snapshot.state.subnetworks.map((network) => ({
    label: network.name,
    value: network.id,
  })),
)

const activeNetwork = computed(
  () =>
    snapshot.state.subnetworks.find(
      (network) => network.id === snapshot.state.activeSubnetworkId,
    ) ?? null,
)
const activeNetworkName = computed(() => activeNetwork.value?.name ?? '')
const activeNetworkSecret = computed(() => activeNetwork.value?.secret ?? '')
const activeRelayAddr = computed(() => activeNetwork.value?.relayAddrs[0] ?? '')
const activeDiscoveryToken = computed(() => activeNetwork.value?.discoveryTokens[0] ?? '')
const busy = computed(() => snapshot.state.busy)

async function updateActiveNetwork(
  patch: Partial<{ name: string; secret: string; relayAddrs: string[] }>,
) {
  const activeId = activeNetwork.value?.id
  if (!activeId) return
  await controls.updateSubnetwork(activeId, patch)
}

async function updateActiveRelay(value: string) {
  await updateActiveNetwork({ relayAddrs: value ? [value] : [] })
}

function joinFixtureNetwork() {
  controls.joinFixtureNetwork()
}

async function addSubnetwork() {
  await controls.addSubnetwork({
    name: `Subnetwork ${snapshot.state.subnetworks.length + 1}`,
    relayAddrs: [...fixtureNetwork.relayAddrs],
  })
}
</script>
