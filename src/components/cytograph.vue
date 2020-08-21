<template>
  <div id=cysheet>
    <div ref="cyref" id="cy">
    </div>
  </div>
</template>

<script>
import cytoscape from 'cytoscape'
import { colors } from 'quasar'
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
      this.$refs.cyref // .getElementById('container') // container to render in
    )
  },
  methods: {
    initgraph (container) {
      console.log('initializing cytoscape')
      console.log(container)

      var cy = cytoscape({
        container: container, // container to render in
        elements: config.elements,
        style: `
          node {
            background-color: ${colors.getBrand('secondary')};
            label: data(id);
            shape: round-rectangle;
          }

          edge {
            width: 3;
            curve-style: taxi;
            line-color: ${colors.getBrand('primary')};
            target-arrow-color: ${colors.getBrand('primary')};
            source-arrow-color: ${colors.getBrand('primary')};
            target-arrow-shape: square;
            source-arrow-shape: square;
          }
        }
        `,
        layout: {
          animate: true, // whether to animate changes to the layout
          animationDuration: 500, // duration of animation in ms, if enabled
          animationEasing: undefined, // easing of animation, if enabled
          name: 'cose',
          fit: true,
          padding: 30
        }
      })
      cy.fit()
      /* cy.layout({
        name: 'cose',
        animate: true,
        fit: true,
        padding: 30
      }).run() */

      // this.cy = {refrence: cy}
    }
  }
}
</script>

<style>
#cysheet {
  width: 600px;
  height: 200px;
  background-image: url("/grid.png");
}

#cy {
  width: 600px;
  height: 200px;
  position: absolute;
  left: 0;
  top: 0;
  z-index: 999;
}
</style>
