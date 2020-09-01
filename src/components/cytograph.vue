<template>
  <div class="fit" ref="cyref" id="cy">
  </div>
</template>

<script>
import cytoscape from 'cytoscape'
import cola from 'cytoscape-cola'
import { colors } from 'quasar'
var cloneDeep = require('lodash.clonedeep')

cytoscape.use(cola)

console.log('imported cytoscape')

/* var elements = [
  { name: 'A' }
] */

// for cola options check this webpage: https://github.com/cytoscape/cytoscape.js-cola
var layoutoptions = {
  cola: {
    name: 'cola',
    animate: true, // whether to show the layout as it's running
    animationDuration: 500, // duration of animation in ms, if enabled
    maxSimulationTime: 5000, // max length in ms to run the layout
    fit: true, // on every layout reposition of nodes, fit the viewport
    padding: 30 // padding around the simulation
  },
  cose: {
    animate: true, // whether to animate changes to the layout
    animationDuration: 500, // duration of animation in ms, if enabled
    animationEasing: undefined, // easing of animation, if enabled
    name: 'cose',
    fit: true,
    padding: 30
  }
}

export default {
  name: 'cytograph',
  props: ['elementlist'],
  data () {
    return {
      message: 'testmessage'
    }
  },
  mounted () {
    console.log('lifecycle: mounted')
    this.drawgraph()
  },
  computed: {
    graphelements: function () {
      // transform component data into graph format
      // required by cytoscape
      console.log('recompute graph elements')

      var nodes = this.elementlist.components.map(x => {
        return { data: cloneDeep(x), group: 'nodes' }
      })
      console.log(nodes)
      /* var edges = [{
          data: { id: 'abc', source: 'rc', target: 'b' },
          group: 'edges'
        }] */

      return [...nodes]
    }
  },
  watch: {
    graphelements: function () {
      console.log('elements changed!!')
      this.updategraph()
    }
  },
  methods: {
    updategraph () {
      this._cy.elements().remove()
      this._cy.add(this.graphelements)
      this._cy.resize()
      this._cy.fit()
      this._cy.layout(layoutoptions.cola).run()
    },
    drawgraph () {
      console.log('initializing cytoscape')
      // console.log(container)
      var container = this.$refs.cyref // .getElementById('container') // container to render in

      var cy = cytoscape({
        container: container, // container to render in
        elements: this.graphelements,
        // style configuration options: https://js.cytoscape.org/#style
        style: `
          node {
            background-color: ${colors.getBrand('secondary')};
            label: data(name);
            text-valign: center;
            width: label;
            text-wrap: ellipsis;
            font-size: 10;
            text-max-width: 50px;
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
        layout: layoutoptions.cola
      })
      cy.resize()
      cy.fit()
      /* cy.layout({
        name: 'cose',
        animate: true,
        fit: true,
        padding: 30
      }).run() */

      this._cy = cy
    }
  }
}
</script>

<style>
#cy {
  background-image: url("/grid.png");
  min-width: inherit;
  min-height: inherit;

  position: absolute;
  left: 0;
  top: 0;
  z-index: 999;
}
</style>
