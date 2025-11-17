import type { JSONSchema7 } from 'json-schema'
import { createTool } from '../types/toolApi'

const proceduralTreeGenerator = createTool({
  description:
    'Generates an abstract procedural tree graphic in a new browser window using Canvas and JavaScript.',
  longDescription:
    'This tool opens a new browser window and injects an HTML page with a canvas that draws an abstract procedural tree. The tree branches at 45-degree angles, features white trunk and branches, and orange lines representing leaves. It uses randomized segment lengths for organic variation.',
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
      },
      height: {
        type: 'integer',
      },
      trunkLength: {
        type: 'integer',
      },
      maxDepth: {
        type: 'integer',
      },
    },
  } as const satisfies JSONSchema7,
  code: `() => {
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
    return makeTaskResult([
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
