<template>
  <div class="fit" ref="cyref" id="cy">
  </div>
</template>

<script>
import cytoscape from 'cytoscape'
import cola from 'cytoscape-cola'
import spread from 'cytoscape-spread'
import edgehandles from 'cytoscape-edgehandles'
import { colors } from 'quasar'
var cloneDeep = require('lodash.clonedeep')

cytoscape.use(cola)
cytoscape.use(edgehandles)
spread(cytoscape)

console.log('imported cytoscape')

/* var elements = [
  { name: 'A' }
] */

// for cola options check this webpage: https://github.com/cytoscape/cytoscape.js-cola
var layoutOptions = {
  cola: {
    name: 'cola',
    animate: true, // whether to show the layout as it's running
    animationDuration: 500, // duration of animation in ms, if enabled
    maxSimulationTime: 1000, // max length in ms to run the layout
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
  },
  // https://js.cytoscape.org/#layouts/breadthfirst
  breadthfirst: {
    name: 'breadthfirst',
    fit: true,
    grid: false,
    circle: false,
    spacingFactor: 1.0 // default: 1.75
  },
  // https://github.com/cytoscape/cytoscape.js-spread
  spread: {
    name: 'spread',
    prelayout: {
      name: 'breadthfirst',
      fit: true,
      grid: true,
      circle: false,
      spacingFactor: 1.75 // default: 1.75
    }// Layout options for the first phase
  }
}

// check here for all options: https://github.com/cytoscape/cytoscape.js-edgehandles
/* var edgehandleOptions = {
  handlePosition: function (node) {
    return 'middle bottom' // sets the position of the handle in the format of "X-AXIS Y-AXIS" such as "left top", "middle top"
  },
  edgeType: function (sourceNode, targetNode) {
    // can return 'flat' for flat edges between nodes or 'node' for intermediate node between them
    // returning null/undefined means an edge can't be added between the two nodes
    return 'flat'
  },
  complete: function (sourceNode, targetNode, addedEles) {
    // fired when edgehandles is done and elements are added
    console.log('completed')
  },
  snap: true
} */

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

      const nodes = this.elementlist.components.map(x => {
        return { data: cloneDeep(x), group: 'nodes' }
      })
      // console.log(nodes)
      const edges = this.elementlist.links.map(x => {
        return { data: cloneDeep(x), group: 'edges' }
      })

      return [...nodes, ...edges]
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
      // this._cy.resize()
      // this._cy.fit()
      this._cy.layout(layoutOptions.breadthfirst).run()
    },
    drawgraph () {
      console.log('initializing cytoscape')
      // console.log(container)
      var container = this.$refs.cyref // .getElementById('container') // container to render in

      var cy = cytoscape({
        container: container, // container to render in
        elements: this.graphelements,
        // style configuration options: https://js.cytoscape.org/#style
        // also include style configuration for edge handler
        style: `
          node[name] {
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
            source-arrow-color: ${colors.getBrand('secondary')};
            target-arrow-shape: square;
            source-arrow-shape: none;
          }

          .eh-handle {
              background-color: ${colors.getBrand('info')};
              width: 12;
              height: 12;
              shape: ellipse;
              overlay-opacity: 0;
              border-width: 12;
              border-opacity: 0;
          }

          .eh-hover {
              background-color: ${colors.getBrand('info')};
          }

          .eh-source {
              border-width: 2;
              border-color: ${colors.getBrand('info')};
          }

          .eh-target {
              border-width: 2;
              border-color: ${colors.getBrand('info')};
          }

          .eh-preview, .eh-ghost-edge {
              background-color: ${colors.getBrand('info')};
              line-color: ${colors.getBrand('info')};
              target-arrow-color: ${colors.getBrand('info')};
              source-arrow-color: ${colors.getBrand('info')};
          }

          .eh-ghost-edge.eh-preview-active {
              opacity: 0;
          }`,
        layout: layoutOptions.spread
      })
      // cy.resize()
      // cy.fit()

      /* ***** this section defines edge-creation logic ******/
      // we need to save the reference to the component object in a variable as "this"
      // will refeence the global namespace once we are inside the function
      var cytocomponent = this
      function completefunc (sourceNode, targetNode, addedEles) {
        // fired when edgehandles is done and elements are added
        // cy.layout(layoutOptions.cola).run()
        console.log('completed')
        // console.log([sourceNode.data().id, targetNode.data().id])
        cytocomponent.$emit('link-add', sourceNode.data(), targetNode.data())
      }
      const eh = cy.edgehandles({
        snap: true,
        preview: true,
        complete: completefunc,
        handlePosition: function (node) {
          return 'middle bottom' // sets the position of the handle in the format of "X-AXIS Y-AXIS" such as "left top", "middle top"
        }
      })
      // eh.enableDrawMode()

      this._eh = eh
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
