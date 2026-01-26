// testErrors.ts

import { humanizeError, serializeError } from '../utils/error'

type TestCase = {
  name: string
  input: unknown
  mustContain: string[]
}

type TestResult = {
  name: string
  passed: boolean
  output: string
  input: unknown
  missingKeywords: string[]
}

type TestSummary = {
  total: number
  passed: number
  failed: number
  results: TestResult[]
}

// Helper type for an Error that *may* have a `cause` field
type ErrorWithCause = Error & { cause?: unknown }

// Helper type for a cyclic error-like object
type CyclicErrorLike = {
  message: string
  self?: CyclicErrorLike
}

/**
 * Run a set of simple, framework-free tests against `humanizeError`.
 *
 * - For each input, checks that all `mustContain` keywords appear in the output.
 * - Throws an Error if any test fails.
 * - Otherwise returns a summary object.
 */
export function testHumanizeErr(): TestSummary {
  const innerError = new Error('Inner failure message')

  const outerError: ErrorWithCause = new Error('Outer failure message')
  outerError.cause = innerError

  const cyclic: CyclicErrorLike = { message: 'Cyclic reference root' }
  cyclic.self = cyclic // introduce a cycle to test WeakSet handling

  const tests: TestCase[] = [
    {
      name: 'Complex nested Error with cause',
      mustContain: ["'none' is not supported", 'gpt-5.1-codex-mini', 'Chat completion failed!'],
      input: {
        name: 'Error',
        message: 'Chat completion failed!',
        stack:
          'Error: Chat completion failed!\n    at Object.function (https://localhost:9000/packages/taskyon/src/tools/chatCompletionTool.ts?t=1769213187431:799:15)\n    at async handleFunctionExecution (https://localhost:9000/packages/taskyon/src/core/tools.ts?t=1769206020203:71:13)\n    at async https://localhost:9000/packages/taskyon/src/core/taskWorker.ts?t=1769213187431:39:19\n    at async safeExecuteTask (https://localhost:9000/packages/taskyon/src/core/taskWorker.ts?t=1769213187431:55:12)\n    at async https://localhost:9000/packages/taskyon/src/core/taskWorker.ts?t=1769213187431:199:23',
        cause: {
          error: {
            name: 'AI_APICallError',
            message:
              "Unsupported value: 'none' is not supported with the 'gpt-5.1-codex-mini' model. Supported values are: 'low', 'medium', and 'high'.",
            stack:
              "AI_APICallError: Unsupported value: 'none' is not supported with the 'gpt-5.1-codex-mini' model. Supported values are: 'low', 'medium', and 'high'.\n    at https://localhost:9000/node_modules/.q-cache/dev-spa/vite-spa/deps/chunk-WQPKHB2C.js?v=59f8f3e6:2497:14\n    at async postToApi (https://localhost:9000/node_modules/.q-cache/dev-spa/vite-spa/deps/chunk-WQPKHB2C.js?v=59f8f3e6:2383:28)\n    at async OpenAIResponsesLanguageModel.doStream (https://localhost:9000/node_modules/.q-cache/dev-spa/vite-spa/deps/@ai-sdk_openai.js?v=59f8f3e6:4515:50)\n    at async fn (https://localhost:9000/node_modules/.q-cache/dev-spa/vite-spa/deps/ai.js?v=59f8f3e6:8534:25)\n    at async https://localhost:9000/node_modules/.q-cache/dev-spa/vite-spa/deps/ai.js?v=59f8f3e6:4176:24\n    at async _retryWithExponentialBackoff (https://localhost:9000/node_modules/.q-cache/dev-spa/vite-spa/deps/ai.js?v=59f8f3e6:4423:12)\n    at async streamStep (https://localhost:9000/node_modules/.q-cache/dev-spa/vite-spa/deps/ai.js?v=59f8f3e6:8491:15)\n    at async fn (https://localhost:9000/node_modules/.q-cache/dev-spa/vite-spa/deps/ai.js?v=59f8f3e6:8860:9)\n    at async https://localhost:9000/node_modules/.q-cache/dev-spa/vite-spa/deps/ai.js?v=59f8f3e6:4176:24",
            url: 'https://api.openai.com/v1/responses',
            requestBodyValues: {
              model: 'gpt-5.1-codex-mini',
              input: [
                {
                  role: 'developer',
                  content:
                    "You are a helpful assistant called *Taskyon*. Return your answers in markdown format, you can use the following features:\n\n- **Mermaid charts**: Include diagrams, mindmaps, Gantt diagrams, quadrants, and XY charts using the 'mermaid' keyword in fenced code blocks. For example:\n```mermaid\n...\n```\n\n- Our markdown version supports inline-html:\n   * SVG graphics: Use HTML to embed SVG graphics.\n   * HTML widgets: Create interactive elements within the markdown using HTML.\n- **MathJax**: Write mathematical formulas using $$ ... $$ for block formulas and $ ... $ for inline formulas. **Note:** Only `$` and `$$` syntax is supported.\n- use backticks for code:\n  \n```<language>\n  ....\n```\n- and all the other markdown features are supported as well! \n\nPlease use this!  but make it elegant, use it when it makes sense, and not just for the effect.",
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'input_text',
                      text: 'test',
                    },
                  ],
                },
              ],
              reasoning: {
                effort: 'none',
                summary: 'auto',
              },
              stream: true,
            },
            statusCode: 400,
            responseHeaders: {
              'content-length': '271',
              'content-type': 'application/json',
            },
            responseBody:
              '{\n  "error": {\n    "message": "Unsupported value: \'none\' is not supported with the \'gpt-5.1-codex-mini\' model. Supported values are: \'low\', \'medium\', and \'high\'.",\n    "type": "invalid_request_error",\n    "param": "reasoning.effort",\n    "code": "unsupported_value"\n  }\n}',
            isRetryable: false,
            data: {
              error: {
                message:
                  "Unsupported value: 'none' is not supported with the 'gpt-5.1-codex-mini' model. Supported values are: 'low', 'medium', and 'high'.",
                type: 'invalid_request_error',
                param: 'reasoning.effort',
                code: 'unsupported_value',
              },
            },
          },
        },
      },
    },
    {
      name: 'Plain Error instance',
      input: new Error('Something went wrong'),
      mustContain: ['Something went wrong', 'name=Error'],
    },
    {
      name: 'HTTP-style error with status and URL',
      input: {
        message: 'Request failed',
        status: 404,
        statusText: 'Not Found',
        url: 'https://api.example.com/items',
      },
      mustContain: ['Request failed', '404 Not Found', 'URL: https://api.example.com/items'],
    },
    {
      name: 'Axios-style error with response.data',
      input: {
        message: 'Server error',
        status: 500,
        response: {
          data: {
            error: 'Internal error',
            detail: 'Something exploded',
          },
        },
      },
      mustContain: ['Server error', 'Data:', 'Internal error'],
    },
    {
      name: '`msg` field and code/errno meta',
      input: {
        msg: 'Short message',
        code: 'E123',
        errno: 'ECONNRESET',
      },
      mustContain: ['Short message', 'code=E123', 'errno=ECONNRESET'],
    },
    {
      name: 'Error with nested `cause` Error',
      input: outerError,
      mustContain: ['Outer failure message', 'Caused by →', 'Inner failure message'],
    },
    {
      name: 'Object with array-style `cause`',
      input: {
        message: 'Top level failure',
        cause: ['403 Forbidden: access denied', 'Check your credentials'],
      },
      mustContain: ['Top level failure', '403 Forbidden', 'Check your credentials'],
    },
    {
      name: 'Plain string input',
      input: 'just a string error',
      mustContain: ['just a string error'],
    },
    {
      name: 'Number input',
      input: 42,
      mustContain: ['42'],
    },
    {
      name: 'Error-like object with `body` data',
      input: {
        message: 'Body present',
        body: { detail: 'Nope', reason: 'Forbidden' },
      },
      mustContain: ['Body present', 'Data:', 'Nope'],
    },
    {
      name: 'Cyclic object input',
      input: cyclic,
      mustContain: ['Cyclic reference root'],
    },
  ]

  const results: TestResult[] = []

  for (const test of tests) {
    const output = humanizeError(test.input)
    const missing = test.mustContain.filter((kw) => !output.includes(kw))
    const passed = missing.length === 0

    results.push({
      name: test.name,
      passed,
      output,
      input: serializeError(test.input),
      missingKeywords: missing,
    })
  }

  const failedResults = results.filter((r) => !r.passed)
  const passedCount = results.length - failedResults.length

  if (failedResults.length > 0) {
    const details = failedResults
      .map(
        (r) =>
          `- ${r.name}: missing keywords -> ${JSON.stringify(r.missingKeywords)}\n` +
          `  Input was:\n${JSON.stringify(r.input)}\n` +
          `  Output was:\n${r.output}\n`,
      )
      .join('\n')

    throw new Error(
      `humanizeError tests failed (${failedResults.length}/${results.length}):\n` + details,
    )
  }

  return {
    total: results.length,
    passed: passedCount,
    failed: failedResults.length,
    results,
  }
}
