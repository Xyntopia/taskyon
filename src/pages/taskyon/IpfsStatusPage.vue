<template>
  <q-layout view="lHh LpR lfr">
    <q-page-container>
      <q-page class="q-pa-md q-gutter-sm">
        <div class="text-h5">IPFS Node Status</div>
        <q-btn outline label="return to chat" to="/" />
        <q-btn outline label="start" @click="startHelia()" />
        <q-btn outline label="stop" @click="ipfsnode?.stop()" />
        <div>
          Teststring:
          <a :href="'https://ipfs.io/ipfs/' + testcid" target="_blank">{{
            testcid
          }}</a>
        </div>
        <object-tree-view v-model:model-value="status" dense read-only />
        <div class="text-h5 q-mt-md">Logs</div>
        <div class="logs q-mt-sm">
          <q-item v-for="log in logs" :key="log.id" class="q-pa-xs">
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
import { ref, onUnmounted } from 'vue';
import ObjectTreeView from 'src/components/ObjectTreeView.vue';
import { type IpfsNode, useIpfs } from 'src/modules/taskyon/ipfs';

const status = ref<Record<string, unknown>>({});
const logs = ref<Array<{ id: string; content: string; color: string }>>([]);
const pollingInterval = 2000;
let interval: NodeJS.Timeout;
const testcid = ref<string>();

let ipfsnode: IpfsNode | undefined = undefined;

const startHelia = async () => {
  try {
    console.log('Creating Helia node...');

    const { node, exportToIpfs, fetchNodeStatus } = await useIpfs();
    ipfsnode = node;
    console.log('DHT mode set to server');
    console.info('Helia is running');

    /*node.libp2p.addEventListener('peer:discovery', (evt) => {
      console.log(`Discovered peer ${evt.detail.id.toString()}`);
    });

    node.libp2p.addEventListener('peer:connect', (evt) => {
      console.log(`Connected to ${evt.detail.toString()}`);
    });
    node.libp2p.addEventListener('peer:disconnect', (evt) => {
      console.log(`Disconnected from ${evt.detail.toString()}`);
    });*/

    interval = setInterval(async () => {
      status.value = (await fetchNodeStatus()) ?? {};
    }, pollingInterval);

    // Fetch status initially
    status.value = (await fetchNodeStatus()) ?? {};

    // Initial file addition
    const cid = await exportToIpfs('hello, tstest!! :) from taskyon! :)');
    testcid.value = cid.toString();
  } catch (error) {
    console.error('Error initializing Helia node:', error);
    console.log('Error initializing Helia node');
  }
};

onUnmounted(() => {
  clearInterval(interval);
  if (ipfsnode) {
    ipfsnode.stop();
    console.log('Helia node stopped');
  }
});
</script>
