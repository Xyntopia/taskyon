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
    <template v-slot:before>
      <q-icon :name="matElectricalServices"></q-icon>
    </template>
    <template v-slot:after>
      <InfoDialog>
        <div>
          You can add more api Keys in settings if you want to activate
          additional backends
        </div>
      </InfoDialog>
      <q-btn
        v-if="moreSettings"
        to="/settings/llmproviders"
        flat
        label="More Settings"
      />
    </template>
  </q-select>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import { matElectricalServices } from '@quasar/extras/material-icons';
import InfoDialog from './InfoDialog.vue';

const model = defineModel<string | null>();

defineProps<{
  moreSettings?: boolean;
}>();
const state = useTaskyonStore();
</script>
