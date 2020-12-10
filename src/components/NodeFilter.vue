<template>
  <div class="column items-left">
    <div class="col-auto text-h6 text-primary self-center" >
        FILTER
        <q-btn outline dense @click="onClearFilters" label="clear"/>
    </div>
    <div class="col-auto self-center">
      <q-select filled :value="preset" :options="presetOptions"
        label="Select Preset" :dense="true" :options-dense="true"
        @input="onSelectPreset"
        >
      </q-select>
      <q-separator inset spaced/>
      <q-btn-toggle
        :value="value.qmode"
        no-caps rounded unelevated
        toggle-color="primary" color="tools" text-color="primary"
        clearable
        :options="[
          {label: 'Filter', value: 'filter'},
          {label: 'FullText', value: 'text'},
          {label: 'AI', value: 'similar'}
        ]"
        @input=onQModeChange($event)
      />
    </div>
    <q-separator inset spaced/>
    <div
      v-for="filter in value.filters"
      v-bind:key="filter.type+filter.target+filter.method"
      class="col-auto">
      <q-select
        use-input
        multiple
        clearable
        :value="filter.value"
        color="primary"
        dense
        label-color="primary"
        outlined
        :options="filteroptions(filter)"
        hide-dropdown-icon
        input-debounce="0"
        use-chips
        hide-bottom-space
        new-value-mode="add-unique"
        :label="filter.type + ': <' + filter.target + '> : ' + filter.method"
        @input="onFilterChange(filter,$event)">
        <template v-slot:selected-item="scope">
          <q-chip
            removable square outline dense
            @remove="scope.removeAtIndex(scope.index)"
            :tabindex="scope.tabindex"
            color="primary"
            text-color="primary"
            class="bg-white q-mb-none q-ml-none"
          >
            {{ scope.opt }}
          </q-chip>
        </template>
      </q-select>
    </div>
  </div>
</template>

<script>
// import { mapGetters, mapActions } from 'vuex'
// import { mapState, mapGetters } from 'vuex'
import { mapState } from 'vuex'

var cloneDeep = require('lodash.clonedeep')

export default {
  name: 'NodeFilter',
  props: {
    value: {
      type: Object,
      default: function () {
        return {
          qmode: 'filter',
          filters: []
        }
      }
    }
  },
  data () {
    return {
      preset: null
    }
  },
  computed: {
    presetOptions () {
      return Object.keys(this.filterPresets)
    },
    ...mapState('comcharax', [
      'filterPresets'
    ])
  },
  methods: {
    onClearFilters () {
      this.preset = null
      this.$emit('input', { qmode: this.value.qmode, filters: [] })
    },
    onSelectPreset (preset) {
      console.log(preset)
      var newFilter = cloneDeep(this.filterPresets[preset])
      this.$emit('input', { qmode: 'filter', filters: [newFilter] })
    },
    filteroptions (filter) {
      return ['TODO1', 'TODO2', 'TODO3...']
    },
    onQModeChange (value) {
      console.log(value)
      this.sendFilterEvent({ qmode: value })
    },
    onFilterChange (filter, value) {
      console.log(filter)
      console.log(value)
      // TODO: find this filter and replace it by the new one.
      // var newFilters = cloneDeep(this.value.filters)
      var newFilter = cloneDeep(filter)
      newFilter.value = value
      this.sendFilterEvent({ filters: [newFilter] })
    },
    sendFilterEvent (updatedValues) {
      var newFilter = cloneDeep(this.value)
      newFilter = { ...newFilter, ...updatedValues }
      console.log(newFilter)
      this.$emit('input', newFilter)
    }
  }
}
</script>
