<template>
  <q-layout view="lHh LpR lfr">
    <q-page-container>
      <q-page class="q-pa-md">
        <div class="text-h5">IPFS Node Status</div>
        <q-list bordered>
          <q-item v-for="(value, key) in status" :key="key" class="q-pa-xs">
            <q-item-section>{{ key }}</q-item-section>
            <q-item-section>{{ value }}</q-item-section>
          </q-item>
        </q-list>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { strings } from '@helia/strings';
import { createHelia } from 'helia';
import { ref, onMounted, onUnmounted } from 'vue';

const status = ref<Record<string, unknown>>({});
const pollingInterval = 2000; // Check status every 5 seconds

let node: Awaited<ReturnType<typeof createHelia>>;

const getConnectedPeers = (helia: typeof node) => {
  const peers = helia.libp2p.getPeers();
  return {
    peer_num: peers.length,
  };
  /*connectedPeersList.innerHTML = '';
  for (const peer of peers) {
    const peerEl = document.createElement('li');
    peerEl.innerText = peer.toString();
    connectedPeersList.appendChild(peerEl);
  }*/
};

async function fetchNodeStatus() {
  if (!node) return;

  try {
    const metrics = node.metrics;
    status.value = {
      'node started': node ? true : false,
      ...getConnectedPeers(node),
      metrics: (metrics ?? {}) as Record<string, unknown>,
    };

    //console.log(metrics);
  } catch (error) {
    console.error('Error fetching node status:', error);
    if (error instanceof Error) {
      status.value = { error: error.message };
    }
  }
}

let interval: NodeJS.Timeout;

onMounted(async () => {
  // Set up polling
  interval = setInterval(fetchNodeStatus, pollingInterval);

  node = await createHelia();
  console.log('created helia node...');
  await node.libp2p.services.dht.setMode('server');

  const s = strings(node);

  const testcid = await s.add(
    'hello from tasyon! :)' + new Date().toISOString(),
  );

  console.log('cid', testcid.toString());

  // Initial fetch
  await fetchNodeStatus();
});

onUnmounted(() => {
  clearInterval(interval);
  if (node) {
    node.stop(); // Stop Helia node if necessary
  }
});
</script>
