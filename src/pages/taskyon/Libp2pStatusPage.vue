<template>
  <q-layout view="lHh LpR lfr">
    <q-page-container>
      <q-page class="q-pa-md q-gutter-sm">
        <div class="text-h5">IPFS Node Status</div>
        <q-btn outline label="return to chat" to="/" />
        <q-btn outline label="send message" @click="sendMessage()" />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
async function sendMessage() {
  console.log('send message to server....')
}
</script>
