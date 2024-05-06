<!-- Sidebar -->
<template>
  <div>
    <OpenRouterPKCE />
    <div>
      <q-separator spaced />
      <div class="q-pa-sm q-gutter-md">
        <div>Select Default AI Provider</div>
        <div>
          you can find available models here:
          <q-btn
            flat
            color="accent"
            href="https://openrouter.ai/api/v1/models"
            target="_blank"
            >https://openrouter.ai/api/v1/models</q-btn
          >
          as soon as you have logged in to your openrouter account:
          <q-btn
            flat
            color="accent"
            href="https://accounts.openrouter.ai/sign-in"
            target="_blank"
            >https://accounts.openrouter.ai/sign-in</q-btn
          >
        </div>
        <q-select
          v-model="state.chatState.selectedApi"
          emit-value
          dense
          label="select Api"
          :options="
            state.chatState.llmApis.map((api) => ({
              value: api.name,
              label: api.name,
            }))
          "
        />
        <q-input
          v-for="keyname of filteredKeys"
          :key="keyname"
          :type="keyVisible[keyname] ? 'text' : 'password'"
          placeholder="Add API key here!"
          filled
          v-model="state.keys[keyname]"
          :label="`${keyname} API key`"
          ><template v-slot:append>
            <q-icon
              :name="keyVisible[keyname] ? 'visibility' : 'visibility_off'"
              class="cursor-pointer"
              @click="keyVisible[keyname] = !keyVisible[keyname]"
            />
          </template>
        </q-input>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import OpenRouterPKCE from './OpenRouterPKCE.vue';
import { computed, ref } from 'vue';

const keyVisible = ref<Record<string, boolean>>({});

const state = useTaskyonStore();
const filteredKeys = computed(() => {
  return Object.keys(state.keys).filter(
    (name) => !['taskyon', 'jwt'].includes(name)
  );
});
</script>
