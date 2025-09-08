<!--AuthFlow.vue (path:   /oauth/return)-->
<template>
  <q-layout>
    <q-page-container>
      <q-page class="q-pa-md flex flex-center column items-center">
        <q-card flat bordered class="q-pa-lg bg-grey-2 text-center">
          <div>Return from Authentication</div>
          <div v-if="loading">Finalizing login…</div>
          <div v-else-if="error" class="text-negative q-mt-sm">{{ error }}</div>
          <div v-else class="text-positive">
            Access token received. You can now close this window.
          </div>
          <q-btn
            v-if="!loading"
            class="q-mt-md"
            label="Close Window"
            color="primary"
            flat
            @click="closeWindow"
          />
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import type { authReturn } from 'src/modules/oauth'
import { onMounted, ref } from 'vue'

/**
 * This window is meant to be opened as a popup window for oauth applications!
 * it will automatically forward to a specified oauth
 */

// because our service will return to our URL with its oauth query parameters,
// we need the svcId to be base64 encoded so that we can use it as a path
const error = ref<string | null>(null)
const loading = ref(true)

const closeWindow = () => window.close()

// TODO:  google returns something like this:
// http://localhost:9000/oauth/return?code=4/0AVMBsJgOsKHxL-v6wpJvbm2ZiHMxDN7Jb4hdZByA-K1B_XmibJfZ79k9plT8QggKpSE_4A&scope=https://www.googleapis.com/auth/drive.file

// and ehre for the implicit flow:

onMounted(() => {
  // ————————————————
  // else: mode === 'return' (your existing “exchange code for token”)
  window.opener.postMessage(
    { status: 'return', query: window.location.search, hash: window.location.hash } as authReturn,
    window.location.origin,
  )
})
</script>
