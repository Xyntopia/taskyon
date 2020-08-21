<template>
  <div id="cy">
  </div>
</template>

<script>
import cytoscape from 'cytoscape'
import config from './example-config'

console.log('imported cytoscape')

/* var elements = [
  { name: 'A' }
] */

export default {
  name: 'cytograph',
  data () {
    return {
      message: 'testmessage'
    }
  },
  mounted () {
    this.initgraph(
      this.$el // .getElementById('container') // container to render in
    )
  },
  methods: {
    initgraph (container) {
      console.log('initializing cytoscape')
      var container2 = document.getElementById('cy')
      console.log(container2)

      var cy = cytoscape({
        container: container2, // container to render in
        elements: config.elements,
        style: config.style,
        layout: config.layout
      })

      cy.layout({
        name: 'random'
      }).run()

      // this.cy = {refrence: cy}
    }
  }
}
</script>

<style>
#cy {
  width: 800px;
  height: 600px;
  position: absolute;
  left: 0;
  top: 0;
  z-index: 999;
}
</style>
