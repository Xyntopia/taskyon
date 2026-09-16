<template>
  <q-card flat bordered data-cy="sandbox-fetch-settings">
    <q-card-section>
      <div class="text-subtitle1">Sandbox network fetch</div>
      <div class="text-caption">
        Sandboxed nodes ask the host to avoid browser CORS. Secure WSS is the default; direct fetch
        and the legacy HTTP proxy are explicit alternatives.
      </div>
      <q-select
        v-model="transport"
        :options="SANDBOX_FETCH_TRANSPORT_OPTIONS"
        label="Sandbox fetch transport"
        emit-value
        map-options
        outlined
        dense
        data-cy="sandbox-fetch-transport"
      />
      <q-input
        v-if="transport === 'wss'"
        v-model="wssUrl"
        label="Taskyon WSS tunnel URL"
        hint="The authenticated remote tunnel used for approved sandbox requests."
        outlined
        dense
        data-cy="sandbox-fetch-wss-url"
      />
      <q-input
        v-if="transport === 'http'"
        v-model="httpProxyUrl"
        label="Legacy Taskyon HTTP proxy URL"
        hint="Use only when the secure WSS tunnel is unavailable."
        outlined
        dense
        data-cy="sandbox-fetch-proxy-url"
      />
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import {
  SANDBOX_FETCH_TRANSPORT_OPTIONS,
  type SandboxFetchTransport,
} from '@taskyon/common/modules/webFetching/mediatedFetch'

const transport = defineModel<SandboxFetchTransport>('transport', { required: true })
const wssUrl = defineModel<string>('wssUrl', { required: true })
const httpProxyUrl = defineModel<string>('httpProxyUrl', { required: true })
</script>
