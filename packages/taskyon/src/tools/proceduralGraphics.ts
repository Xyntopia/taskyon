import type { JSONSchema7 } from 'json-schema'
import { createTool } from '../types/toolApi'

const proceduralTreeGenerator = createTool({
  description: 'Open a randomized abstract procedural tree graphic in a browser window.',
  longDescription:
    'The tool generates a self-contained canvas visualization and delegates its display to the popup capability. Randomized branch lengths make repeated renders non-deterministic.',
  name: 'proceduralTreeGenerator',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    required: [],
    properties: {
      width: {
        type: 'integer',
        description: 'Requested canvas width in pixels.',
      },
      height: {
        type: 'integer',
        description: 'Requested canvas height in pixels.',
      },
      trunkLength: {
        type: 'integer',
        description: 'Initial trunk length used by the procedural drawing.',
      },
      maxDepth: {
        type: 'integer',
        description: 'Maximum recursive branch depth.',
      },
    },
  } as const satisfies JSONSchema7,
  code: `(_params, ctx) => {
    const html = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Procedural Abstract Tree</title>
    <style>
    body {
          background: #0a2d4d;
          margin: 0;
                overflow: hidden;
                    }
    canvas {
      display: block;
      margin: 0 auto;
      background: #0a2d4d;
    }
  </style>
</head>
<body>
  <canvas id="treeCanvas"></canvas>
  <script>
    const canvas = document.getElementById('treeCanvas');
    const ctx = canvas.getContext('2d');
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    function drawTree(x, y, angle, depth, maxDepth, color) {
      if (depth > maxDepth) return;
      const segmentLength = 60 - depth * 10 + Math.random() * 10;
      const rad = angle * Math.PI / 180;
      const x2 = x + Math.cos(rad) * segmentLength;
      const y2 = y + Math.sin(rad) * segmentLength;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, 6 - depth);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (depth === maxDepth) return;
      const numBranches = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < numBranches; i++) {
        const branchAngle = angle + (i - (numBranches - 1) / 2) * 45;
        const branchColor = (depth === maxDepth - 1) ? '#ff7f1f' : '#ffffff';
        drawTree(x2, y2, branchAngle, depth + 1, maxDepth, branchColor);
      }
    }

    drawTree(width / 2, height * 0.85, -90, 0, 4, '#ffffff');
  <\\/script>
</body>
</html>
\`
    return ctx.createSubtasksResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'functioncall',
            data: {
              name: 'newWindowOpener',
              arguments: { html, windowFeatures: 'width=900,height=900' },
            },
          },
        },
      ],
    ])
  }`,
})

export const proceduralTools = [proceduralTreeGenerator]
