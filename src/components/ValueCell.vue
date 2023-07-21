<template>
  <div class="row items-center justify-between">
    <div class="col-auto">
      <q-input v-if="editMode"
          :value="value"
          filled dense
          type="text"
          debounce="1000"
          @input="$emit('input', $event)"
          @keydown.enter.prevent="editMode = !editMode"
          label="edit value"
        />
      <div v-else>{{ value }}</div>
    </div>
    <div class="col-auto"><q-btn dense size="md" flat :icon="editMode? 'save' : 'edit'" @click="editMode = !editMode"/></div>
  </div>
</template>

<script>
/* eslint-disable */
// import { mapGetters, mapActions } from 'vuex'
// import { mapState, mapGetters } from 'vuex'

export default {
  name: 'ValueCell',
  props: {
    value: [String, Object, Array, Number]
  },
  data () {
    return {
      editMode: false
    }
  }
}
</script>
