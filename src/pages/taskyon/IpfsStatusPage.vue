<template>
  <q-layout view="lHh LpR lfr">
    <q-page-container>
      <q-page class="q-pa-md">
        <div class="text-h5">IPFS Node Status</div>

        <q-btn outline label="start" @click="node.start()" />
        <q-btn outline label="stop" @click="node.stop()" />
        <q-list bordered>
          <q-item v-for="(value, key) in status" :key="key" class="q-pa-xs">
            <q-item-section>{{ key }}</q-item-section>
            <q-item-section>{{ value }}</q-item-section>
          </q-item>
        </q-list>

        <div class="text-h5 q-mt-md">Logs</div>
        <div class="logs q-mt-sm">
          <q-item v-for="log in logs.slice(10)" :key="log.id" class="q-pa-xs">
            <q-item-section :style="{ color: log.color }">{{
              log.content
            }}</q-item-section>
          </q-item>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
/** global Helia, Libp2P, ChainsafeLibp2PYamux, Libp2PWebsockets, Libp2PBootstrap, BlockstoreCore, DatastoreCore */

// not imported from skypack,jsdelivr, nor unpkg because of issues.
// import { noise } from "https://esm.sh/v111/@chainsafe/libp2p-noise@11.0.1/es2022/libp2p-noise.js";
//import { MemoryDatastore } from 'datastore-core';
import { MemoryBlockstore } from 'blockstore-core';
import { LevelDatastore } from 'datastore-level';

import { createHelia as InstantiateHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
//import { EventObject } from '@libp2p/interface';

const status = ref<Record<string, unknown>>({});
const logs = ref<Array<{ id: string; content: string; color: typeof COLORS }>>(
  [],
);
const pollingInterval = 2000;

let node: Awaited<ReturnType<typeof createHelia>>;
let interval: NodeJS.Timeout;

const COLORS = {
  active: '#357edd',
  success: '#0cb892',
  error: '#ea5037',
};

const addLog = (
  content: string,
  color: Keys<typeof COLORS> = COLORS.success,
  id: string = '',
) => {
  logs.value.push({ id, content, color });
};

const getConnectedPeers = async () => {
  if (!node) return { peer_num: 0 };
  const peers = node.libp2p.getPeers();
  /*for (const peer of peers) {
    const peerEl = document.createElement('li');
    peerEl.innerText = peer.toString();
    connectedPeersList.appendChild(peerEl);
  }*/
  return { peer_num: peers.length };
};

/*function maToSelector(string) {
  // #id-ma-/ip4/139.178.91.71/tcp/4001/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN/p2p-circuit/webrtc/p2p/12D3KooWS2Tw7FNsPGBYZ9hBqaa4woNfdfTizgR5y4caqyaogSYh
  return string.replace(/[/.]/gim, '-');
}*/

function getMultiaddrs() {
  if (!node) return { multiaddrList: undefined };

  // multiaddrList.innerHTML = "";
  // console.log(helia.libp2p.getMultiaddrs().map((ma) => ma.toString()).join(', '))
  const multiaddrList = node.libp2p.getMultiaddrs();
  // if (multiaddrs.length === 0) {
  //   return
  // }
  const actualMultiaddrStrings = multiaddrList.map((ma) => ma.toString());

  return { multiaddr: actualMultiaddrStrings };
}

const fetchNodeStatus = async () => {
  if (!node) return;

  try {
    const metrics = node.metrics;
    const connectedPeers = await getConnectedPeers();

    let statusText = node.libp2p.status; // ? 'Online' : 'Offline';
    const dhtMode = await node.libp2p.services.dht.getMode();
    statusText = `${statusText} - ${
      dhtMode === 'client' ? 'DHT Client' : 'DHT Server'
    }`;

    status.value = {
      ...status.value,
      'node started': node ? true : false,
      ...connectedPeers,
      metrics: metrics ?? {},
      dhtMode: statusText,
      ...getMultiaddrs(),
    };
  } catch (error) {
    console.error('Error fetching node status:', error);
    if (error instanceof Error) {
      status.value = { error: error.message };
    }
  }
};

const addTestFile = async () => {
  if (!node) return;

  try {
    addLog('Adding a test file to Helia...', COLORS.active);

    const fs = unixfs(node);
    const encoder = new TextEncoder();
    const fileContent = encoder.encode(
      `Test file content - ${new Date().toISOString()}`,
    );
    const fileToAdd = { path: 'testfile.txt', content: fileContent };

    const cid = await fs.addFile(fileToAdd, node.blockstore);

    addLog(`File added: CID ${cid.toString()}`, COLORS.success, cid.toString());
    addLog(`Preview: https://ipfs.io/ipfs/${cid.toString()}`, COLORS.success);
  } catch (error) {
    console.error('Error adding file:', error);
    addLog('Error adding file', COLORS.error);
  }
};

const createHelia = async () => {
  // https://github.com/ipfs/js-stores
  //  for different persistence methods
  // application-specific data lives in the datastore
  const datastore = new LevelDatastore('helia-example');
  const blockstore = new MemoryBlockstore();

  const heliaInstance = await InstantiateHelia({
    datastore,
    blockstore,
  });
  addLog('Created Helia instance', COLORS.success);

  return heliaInstance;
};

onMounted(async () => {
  try {
    addLog('Creating Helia node...', COLORS.active);

    node = await createHelia();
    await node.libp2p.services.dht.setMode('server');
    console.info('Helia is running');

    node.libp2p.addEventListener('peer:discovery', (evt) => {
      addLog(`Discovered peer ${evt.detail.id.toString()}`);
    });

    node.libp2p.addEventListener('peer:connect', (evt) => {
      addLog(`Connected to ${evt.detail.toString()}`);
    });
    node.libp2p.addEventListener('peer:disconnect', (evt) => {
      addLog(`Disconnected from ${evt.detail.toString()}`);
    });

    console.info('PeerId:', node.libp2p.peerId.toString());
    status.value['peerid'] = node.libp2p.peerId.toString();
    addLog('Helia node created successfully', COLORS.success);

    await node.libp2p.services.dht.setMode('server');
    addLog('DHT mode set to server', COLORS.success);

    interval = setInterval(fetchNodeStatus, pollingInterval);

    // Initial file addition
    await addTestFile();

    // Fetch status initially
    await fetchNodeStatus();
  } catch (error) {
    console.error('Error initializing Helia node:', error);
    addLog('Error initializing Helia node', COLORS.error);
  }
});

onUnmounted(() => {
  clearInterval(interval);
  if (node) {
    node.stop();
    addLog('Helia node stopped', COLORS.active);
  }
});
</script>
