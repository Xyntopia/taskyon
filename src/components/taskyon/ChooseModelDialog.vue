<template>
  <ResponsiveMenuDialogBtn
    size="sm"
    no-caps
    class="col-auto model-history"
    dense
    flat
    maximized
    data-cy-menu="model-selection"
  >
    <template #btnContent>
      <q-icon :name="matSmartToy" />
      <div data-cy="model-id" class="q-pl-xs ellipsis">
        {{ `${tystate.currentModelId}` }}
      </div>
      <div class="text-weight-thin gt-xs">/{{ state.llmSettings.selectedApi }}</div>
    </template>
    <template #default="{ close }">
      <q-list dense style="min-width: 100px">
        <div class="row">
          <q-btn square flat :icon="matSmartToy" label="Model List" to="/pricing" />
          <ApiSelect v-model="state.llmSettings.selectedApi" more-settings />
        </div>
        <q-separator />
        <q-item-label header>Previously selected AI models!</q-item-label>
        <q-item v-if="state.modelHistory.length === 0" v-close-popup>
          No other models were selected yet!
        </q-item>
        <q-item
          v-for="(m, idx) in state.modelHistory"
          :key="m"
          v-close-popup
          clickable
          @click="tystate.updateModelAndApi({ newName: m })"
        >
          <q-item-section>{{ state.modelHistory.length - idx }}: {{ m }}</q-item-section>
        </q-item>
        <q-separator />
        <ModelSelection
          v-model:selected-api="selectedApi"
          class="q-px-xs self-stretch"
          :used-key="tystate.taskyonKey"
          :selected-model="tystate.currentModelId ?? 'no valid model selected...'"
          :model-list="state.appConfiguration.expertMode"
          :select-api="state.appConfiguration.expertMode"
          :model-options="Object.values(tystate.llmModels)"
          :allowed-models="tystate.tyKeyAllowedModels"
          @update-bot-name="
            (bot) => {
              tystate.updateModelAndApi(bot)
              close()
            }
          "
        />
        <InfoDialog
          v-if="tystate.currentModelId && tystate.currentModel?.description"
          :round="false"
          class="fit text-info"
          square
          :dense="false"
          label="Info about current model"
          no-caps
          :info-text="tystate.currentModel?.description || ''"
        />
      </q-list>
      <q-card-actions v-if="$q.platform.is.mobile" class="float-right">
        <q-btn v-close-popup flat label="Ok" />
      </q-card-actions>
    </template>
  </ResponsiveMenuDialogBtn>
</template>

<script setup lang="ts">
import { matSmartToy } from '@quasar/extras/material-icons'
import InfoDialog from '@taskyon/shared/components/InfoDialog.vue'
import ResponsiveMenuDialogBtn from '@taskyon/shared/components/ResponsiveMenuDialogBtn.vue'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { toRefs } from 'vue'
import ApiSelect from './ApiSelect.vue'
import ModelSelection from './ModelSelection.vue'

const state = useAppStateStore()
const tystate = useTaskyonStore()

const { selectedApi } = toRefs(state.llmSettings)
</script>
