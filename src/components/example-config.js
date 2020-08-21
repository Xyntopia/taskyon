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
  ]
}

export default config
