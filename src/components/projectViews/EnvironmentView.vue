<!--EnvironmentView.vue-->
<template>
  <q-tabs v-model="selectedTab">
    <q-tab name="map" label="Map"></q-tab>
    <q-tab name="documents" label="Documents"></q-tab>
    <q-tab name="data" label="Data"></q-tab>
  </q-tabs>
  <q-tab-panels v-model="selectedTab" class="col items-stretch" keep-alive>
    <q-tab-panel name="map" class="column items-stretch">
      <div class="row items-center col-auto q-gutter-xs">
        <div class="col">
          <q-input
            v-model="placeName"
            label="Enter location"
            dense
            outlined
            @keyup.enter="handleFind"
          />
        </div>
        <div class="col-auto">
          <q-btn label="Find" color="primary" @click="handleFind" />
        </div>
        <div class="col-auto">Selected zones: {{ model.input.selectedZones?.length }}</div>
      </div>
      <EnvironmentMap
        class="col"
        ref="environmentMapRef"
        v-model:selectedZones="model.input.selectedZones"
        :external-feature-layers="layers"
        :initial-center="[32.7157, -117.1611]"
        :initial-zoom="9"
      />
    </q-tab-panel>
    <q-tab-panel name="documents" class="column items-stretch">
      <div class="q-gutter-sm column items-center">
        <FileDropzone
          accept=".pdf"
          disable-dropzone-border
          @add-files="
            (files: File[]) => {
              console.log('adding file!', files)
              environment.input.zoningOrdinance = files[0]!
            }
          "
        >
          <q-btn flat :icon="matFileUpload"> Upload zoning ordinance </q-btn>
        </FileDropzone>
        currently loaded:
        {{ environment.input.zoningOrdinance?.name ?? 'None' }}
        <q-btn
          label="Analyze zoning ordinance"
          color="primary"
          unelevated
          @click="() => environment.extractZoneInfos()"
          :disable="!environment.input.zoningOrdinance"
          :loading="isProcessing"
        />
        <q-btn
          label="Clear Zones"
          flat
          @click="() => (environment.output.zoneInfos = null)"
          :disable="!environment.input.zoningOrdinance"
          :loading="isProcessing"
        />
      </div>
      <div>
        Permitted (P), require Conditional Use Permit (C), or Not Allowed (N)
        <q-table
          v-if="environment.output.zoneInfos"
          flat
          title="Zoning Infos"
          bordered
          :rows="environment.output.zoneInfos.zones"
          row-key="zone"
          :pagination="{
            rowsPerPage: 50,
          }"
        >
          <template v-slot:body-cell="props">
            <q-td
              :props="props"
              :class="props.value === 'P' ? 'bg-green' : props.value === 'C' ? 'bg-yellow' : ''"
            >
              {{ props.value }}
            </q-td>
          </template>
        </q-table>
      </div>
    </q-tab-panel>
    <q-tab-panel name="data" class="column items-stretch">
      Environment Data
      <ObjectTreeView hide-missing dense copy-btn lazy-render v-model="environment.input" />
    </q-tab-panel>
  </q-tab-panels>
</template>

<script setup lang="ts">
import { matFileUpload } from '@quasar/extras/material-icons'
import EnvironmentMap from 'src/components/EnvironmentMap.vue'
import FileDropzone from 'src/components/FileDropzone.vue'
import { syncRefsWithLocalStorage } from 'src/modules/saveState'
import { useEnvironment } from 'src/stores/model/environment'
import { useJouliosModel } from 'src/stores/model/model'
import { ref } from 'vue'

const selectedTab = ref('environment')
const environmentMapRef = ref<InstanceType<typeof EnvironmentMap> | null>(null)
const model = useJouliosModel()
const environment = useEnvironment()
const isProcessing = ref(false)

syncRefsWithLocalStorage('EnvironmentView', { selectedTab })

const logPrefix = '[ProjectView]'

const getGenericMap = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gm = environmentMapRef.value?.$refs?.mapRef as any
  console.log(`${logPrefix} getGenericMap() ->`, gm ? 'OK' : 'null/undefined', {
    zonesMapRef: !!environmentMapRef.value,
  })
  return gm
}

const layers = [
  {
    features: './map_layers/Kern_County_Zoning.zip',
    id: 'Zones',
    interactive: false,
    style: {
      color: 'grey',
      fillColor: 'grey',
      weight: 0.5,
      fillOpacity: 0.4,
    },
  },
  {
    features: './map_layers/Kern_County_Parcel.zip',
    id: 'Parcels',
    interactive: true,
    style: {
      color: 'orange',
      weight: 2,
    },
  },
]

const placeName = ref('')

const handleFind = async () => {
  console.log(`${logPrefix} handleFind()`, { placeName: placeName.value })
  const gm = getGenericMap()
  if (!gm) {
    console.warn(`${logPrefix} handleFind(): GenericMap not ready`)
    return
  }
  if (!placeName.value.trim()) {
    console.warn(`${logPrefix} handleFind(): Empty place name`)
    return
  }

  try {
    console.log(`${logPrefix} handleFind(): calling geocodeAndZoom`, { placeName: placeName.value })
    const t0 = performance.now()
    const result = await gm.geocodeAndZoom(placeName.value, { zoom: 15 })
    console.log(`${logPrefix} handleFind(): geocodeAndZoom result`, result, {
      durationMs: Math.round(performance.now() - t0),
    })
  } catch (err) {
    console.error(`${logPrefix} handleFind(): geocodeAndZoom error`, err)
  }
}
</script>
