import type { JSONSchema7 } from 'json-schema'
import { createTool } from '../types/toolApi'

export const executeJavaScript = createTool({
  code: `async function ({ code }) {
    if (typeof code !== 'string' || code.length === 0) {
      throw new Error('A non-empty JavaScript program is required');
    }
    const logMessages = [];
    const sandboxConsole = Object.freeze({
      log: (...args) => logMessages.push(args.map(String).join(' ')),
      info: (...args) => logMessages.push(args.map(String).join(' ')),
      warn: (...args) => logMessages.push(args.map(String).join(' ')),
      error: (...args) => logMessages.push(args.map(String).join(' ')),
    });
    const evaluate = new Function('console', 'code', '"use strict"; return eval(code);');
    const result = await evaluate(sandboxConsole, code);
    return { result, 'console.log': logMessages };
  }`,
  description: 'Runs JavaScript code in a reusable, isolated Taskyon sandbox.',
  longDescription: `Runs JavaScript in an isolated, resource-limited runtime. Network requests use
Taskyon's mediated fetch capability and are denied unless the host policy authorizes the exact tool
revision and destination origin. Browser DOM and direct host access are unavailable.`,
  name: 'executeJavaScript',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The JavaScript code to execute.',
      },
    },
    required: ['code'],
    additionalProperties: false,
  } as const satisfies JSONSchema7,
})
