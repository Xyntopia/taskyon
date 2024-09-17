<template>
  <div class="row items-center">
    <q-select
      v-model="model"
      emit-value
      outlined
      color="secondary"
      dense
      label="Provider"
      :options="
        Object.keys(state.llmSettings.llmApis).filter(
          (apiName) => state.keys[apiName],
        )
      "
    >
    </q-select>
    <q-btn
      v-if="moreSettings"
      to="/settings/aiserviceprovider"
      flat
      aria-label="ai service settings"
    >
      ><q-icon :name="matSettings"></q-icon>
      <q-icon :name="matElectricalServices"></q-icon>
      <q-tooltip>
        You can add more api Keys in settings if you want to activate additional
        backends.
      </q-tooltip>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import {
  matElectricalServices,
  matSettings,
} from '@quasar/extras/material-icons';

const model = defineModel<string | null>();

defineProps<{
  moreSettings?: boolean;
}>();
const state = useTaskyonStore();
</script>
