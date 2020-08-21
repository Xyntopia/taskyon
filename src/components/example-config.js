const config = {
  elements: [
    {
      data: { id: 'a' },
      position: { x: 589, y: 182 },
      group: 'nodes'
    },
    {
      data: { id: 'b' },
      position: { x: 689, y: 282 },
      group: 'nodes'
    },
    {
      data: { id: 'c' },
      position: { x: 489, y: 282 },
      group: 'nodes'
    },
    {
      data: { id: 'ab', source: 'a', target: 'b' },
      group: 'edges'
    },
    {
      data: { id: 'ac', source: 'b', target: 'c' },
      group: 'edges'
    }
  ],
  style: [
    {
      selector: 'node',
      style: { 'background-color': '#66f', label: 'data(id)' }
    },
    {
      selector: 'edge',
      style: {
        width: 10,
        'curve-style': 'bezier',
        'line-color': '#f00',
        'target-arrow-color': '#f00',
        'target-arrow-shape': 'triangle'
      }
    }
  ],
  layout: {
    animate: true, // whether to animate changes to the layout
    animationDuration: 500, // duration of animation in ms, if enabled
    animationEasing: undefined, // easing of animation, if enabled
    name: 'grid',
    rows: 2
  }
}

export default config
