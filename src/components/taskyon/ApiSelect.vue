<template>
  <div class="row items-center">
    <!--Show only Providers for which we have an actual key!-->
    <q-select
      v-model="model"
      emit-value
      borderless
      color="secondary"
      dense
      label="Provider"
      :options="tystate.availableProviders"
    >
    </q-select>
    <q-btn
      v-if="moreSettings"
      to="/settings/aiserviceprovider"
      flat
      aria-label="ai service settings"
    >
      <q-icon :name="matSettings"></q-icon>
      <q-icon :name="matElectricalServices"></q-icon>
      <q-tooltip>
        You can add more api Keys in settings if you want to activate additional backends.
      </q-tooltip>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import { matElectricalServices, matSettings } from '@quasar/extras/material-icons'
import { useTaskyonStore } from 'src/stores/taskyonState'

const model = defineModel<string | null>()

defineProps<{
  moreSettings?: boolean
}>()

const tystate = useTaskyonStore()
</script>
