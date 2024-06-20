<template>
  <q-select
    v-model="model"
    emit-value
    outlined
    color="secondary"
    dense
    label="Provider"
    :options="
      Object.keys(state.llmSettings.llmApis).filter(
        (apiName) => state.keys[apiName]
      )
    "
  >
    <template v-slot:after>
      <q-btn
        v-if="moreSettings"
        to="/settings/llmproviders"
        flat
        :icon="matSettings"
      >
        <q-icon :name="matElectricalServices"></q-icon>
        <q-tooltip>
          You can add more api Keys in settings if you want to activate
          additional backends.
        </q-tooltip>
      </q-btn>
    </template>
  </q-select>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import {
  matElectricalServices,
  matSettings,
} from '@quasar/extras/material-icons';
import InfoDialog from './InfoDialog.vue';

const model = defineModel<string | null>();

defineProps<{
  moreSettings?: boolean;
}>();
const state = useTaskyonStore();
</script>
