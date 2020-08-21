<template>
  <div class="container">
  </div>
</template>

<script>
import { colors } from 'quasar'

var mxgraph = require('mxgraph')({
  mxImageBasePath: './src/images',
  mxBasePath: './src'
})

console.log('imported mxgraph')

/* var elements = [
  { name: 'A' }
] */

export default {
  name: 'mxgraph',
  data () {
    return {
      message: 'testing graph',
      graph: null
    }
  },
  mounted () {
    this.initgraph()
  },
  methods: {
    initgraph () {
      var container = this.$el
      console.log('initializing mxgraph')
      console.log(container)
      // Program starts here. Creates a sample graph in the
      // DOM node with the specified ID. This function is invoked
      // from the onLoad event handler of the document (see below).
      // Checks if the browser is supported
      if (!mxgraph.mxClient.isBrowserSupported()) {
        // Displays an error message if the browser is not supported.
        mxgraph.mxUtils.error('Browser is not supported!', 200, false)
      } else {
        // Disables the built-in context menu
        mxgraph.mxEvent.disableContextMenu(container)

        // Creates the graph inside the given container
        // eslint-disable-next-line
        var graph = new mxgraph.mxGraph(container)
        this.graph = graph
        graph.setPanning(true)
        graph.panningHandler.useLeftButtonForPanning = true
        graph.setAllowDanglingEdges(false)
        graph.connectionHandler.select = false

        // Disables basic selection and cell handling
        // f the graph should be editable this has to be enabled
        graph.setEnabled(false)

        // Changes the default vertex style in-place
        var nodecolor = colors.getBrand('secondary')
        var style = graph.getStylesheet().getDefaultVertexStyle()
        style.shape = 'box' // mxgraph.mxConstants.SHAPE_ELLIPSE
        style.rounded = true
        style.fillColor = nodecolor
        style.strokeColor = nodecolor
        style.fontColor = colors.getBrand('dark')
        // style.gradientColor = colors.getBrand('secondary')
        style.perimeter = mxgraph.mxPerimeter.EllipsePerimeter
        style.fontSize = '20'

        var estyle = graph.getStylesheet().getDefaultEdgeStyle()
        estyle.rounded = true
        // estyle.edgeStyle = mxgraph.mxEdgeStyle.SegmentConnector
        estyle.edgeStyle = mxgraph.mxEdgeStyle.EntityRelation
        // estyle.edgeStyle = mxgraph.mxEdgeStyle.ElbowConnector
        // estyle.edgeStyle = mxgraph.mxEdgeStyle.OrthConnector
        // estyle.startSize = 20
        // estyle.endSize = 5
        // estyle.endArrow = 'none'
        // estyle.strokeColor = colors.getBrand('primary')
        // estyle.labelBackgroundColor = '#FFFFFF'
        // estyle.strokeWidth = 5
        // 'startArrow=dash;startSize=12;endArrow=none;=#FFFFFF;strokeColor=#FF0000'
        //
        // Specifies the alternate edge style to be used if the main control point on an edge is being doubleclicked.
        // graph.alternateEdgeStyle = 'elbow=vertical'

        // Not sure if this works if "left-mouse-panning" is enabled, as it also uses
        // the left mouse button
        // Enables rubberband selection
        // new mxgraph.mxRubberband(graph);

        // Gets the default parent for inserting new cells. This
        // is normally the first child of the root (ie. layer 0).
        var parent = graph.getDefaultParent()

        // Creates a layout algorithm to be used
        // with the graph
        // mxPartitionLayout
        // mxRadialTreeLayout
        // eslint-disable-next-line
        var slayout = new mxgraph.mxRadialTreeLayout(graph)
        // mxEdgeLabelLayout
        // mxStackLayout
        // mxCompositeLayout
        // mxCompactTreeLayout
        // mxCircleLayout
        // eslint-disable-next-line
        var hlayout = new mxgraph.mxHierarchicalLayout(graph)
        // eslint-disable-next-line
        var olayout = new mxgraph.mxFastOrganicLayout(graph)
        // eslint-disable-next-line
        var playout = new mxgraph.mxParallelEdgeLayout(graph)
        // Moves stuff wider apart than usual
        olayout.forceConstant = 50

        var layout = olayout
        layout.disableEdgeStyle = false

        // Adds cells to the model in a single step
        graph.getModel().beginUpdate()
        var w = 30
        var h = 30
        try {
          var v1 = graph.insertVertex(parent, null, 'A', 0, 0, w, h)
          var v2 = graph.insertVertex(parent, null, 'B', 0, 0, w, h)
          var v3 = graph.insertVertex(parent, null, 'C', 0, 0, w, h)
          var v4 = graph.insertVertex(parent, null, 'D', 0, 0, w, h)
          var v5 = graph.insertVertex(parent, null, 'E', 0, 0, w, h)
          var v6 = graph.insertVertex(parent, null, 'F', 0, 0, w, h)
          var v7 = graph.insertVertex(parent, null, 'G', 0, 0, w, h)
          var v8 = graph.insertVertex(parent, null, 'H', 0, 0, w, h)
          // the following edged could also be declared as variables if necessary:
          // var e1 = graph.insertEdge(parent, null, 'ab', v1, v2)
          graph.insertEdge(parent, null, 'ac', v1, v3)
          graph.insertEdge(parent, null, 'cd', v3, v4)
          graph.insertEdge(parent, null, 'be', v2, v5)
          graph.insertEdge(parent, null, 'cf', v3, v6)
          graph.insertEdge(parent, null, 'ag', v1, v7)
          graph.insertEdge(parent, null, 'gh', v7, v8)
          graph.insertEdge(parent, null, 'gc', v7, v3)
          graph.insertEdge(parent, null, 'gd', v7, v4)
          graph.insertEdge(parent, null, 'eh', v5, v8)

          // Executes the layout
          layout.execute(parent)
          // playout.execute(parent)
        } finally {
          // Updates the display
          console.log('layouting worked!')
          graph.getModel().endUpdate()

          /*
          estyle = graph.getStylesheet().getDefaultEdgeStyle()
          estyle.rounded = true
          // estyle.styleEdge = mxgraph.mxEdgeStyle.ElbowConnector
          // estyle.style = 'orthogonalEdgeStyle'
          estyle.startSize = 20
          estyle.endSize = 5
          estyle.endArrow = 'none'
          estyle.strokeColor = colors.getBrand('primary')
          estyle.labelBackgroundColor = '#FFFFFF'
          estyle.strokeWidth = 5
          */
        }
      }
    }
  }
}
</script>

<style scoped>
  .container {
    width: 100%;
    height: 100%;
    overflow: hidden;
    text-align: center;
    /* background-image: url("/grid.png"); */
  }
</style>
