import type { JSONSchema7 } from 'json-schema'
import { createTool } from '../types/toolApi'

const testSecretStore = createTool({
  name: 'testSecretStore',
  description: 'Development-only check that writes and reads a Taskyon secret value.',
  longDescription:
    'This diagnostic capability mutates the current secret store and returns the round-tripped value. It is intended for runtime verification, not ordinary secret management.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The secret key to test',
        default: 'test-secret-key',
      },
      value: {
        type: 'string',
        description: 'The value to store under that key',
        default: 'test-secret-value',
      },
    },
    required: ['key', 'value'],
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  function: async ({ key, value }, ctx) => {
    const TOKEN = await ctx.getSecret('oauth-access-token', false)
    console.log('testSecretStore oauth-access-token', TOKEN)

    // read it back (force unencrypted fetch)
    const seeifitsthere = await ctx.getSecret(key, false)
    console.log('seeifitsthere', seeifitsthere)

    // store the secret
    console.log('setting secret', key, value)
    await ctx.setSecret(key, value)

    console.log('retrieving secret', key, value)
    // read it back (force unencrypted fetch)
    const retrieved = await ctx.getSecret(key, false)

    console.log('retrieved secret', retrieved)
    return ctx.createSubtasksResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'structured',
            data: { key, setValue: value, retrievedValue: retrieved },
          },
        },
      ],
    ])
  },
})

/**
 * postMessageTester
 * -----------------
 * A minimal tool that:
 *  1. Renders an HTML button.
 *  2. When the button is clicked, the UI posts a message through a MessageChannel.
 *  3. On its next invocation, the tool receives that message via `ctx.port`
 *     and shows an alert.
 */
export const postMessageTester = createTool({
  name: 'postMessageTester',
  description: 'Development-only interactive check for Taskyon UI messages and continuation tasks.',
  longDescription:
    'The first call renders a button and schedules a visible continuation; the second waits for the matching host interaction and returns its payload. It is a MessageChannel diagnostic, not a general UI tool.',
  parameters: {
    type: 'object',
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  code: `async (_, ctx) => {
    const taskChain = await ctx.getExecutionTaskChain()
    const previousCall = taskChain.at(-3)
    const thisMessage = taskChain.at(-1)
    // ────────────────────────────────────────────────────────────────────────────
    // SECOND CALL ─ wait for the matching UI interaction
    // ────────────────────────────────────────────────────────────────────────────
    if (
      previousCall?.content.type === 'functioncall' &&
      previousCall.content.data.name === 'postMessageTester' &&
      thisMessage?.parentID === previousCall.id
    ) {
      console.log('waiting for message from UI...')
      const payload = await ctx.waitForInteraction()
      if (payload?.text !== 'Button pressed!') {
        throw new Error('Post-message tester received an unexpected interaction payload.')
      }
      const msg = JSON.stringify(payload)
      return ctx.createSubtasksResult([
        [
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: \`Received message from UI: \${msg}\`,
            },
          },
        ],
      ])
    }

    // ────────────────────────────────────────────────────────────────────────────
    // FIRST CALL ─ render UI and schedule follow-up
    // ────────────────────────────────────────────────────────────────────────────
    const uiHtml = /* html */ \`
  <div>
    <button id="demo-btn">Click to send message</button>
  </div>

  <script type="module">
    // When the user clicks the button, post a message to the parent window (assuming this is an iframe).
    document.getElementById('demo-btn').addEventListener('click', () => {
    window.parent.postMessage({ clickedAt: Date.now(), text: 'Button pressed!' }, '*');
    });
  </script>
  \`

    console.log('Rendering UI for postMessageTester...')
    // Return the UI now, and queue up a second call to this same tool.
    return ctx.createSubtasksResult([
      [
        {
          role: 'assistant',
          content: { type: 'message', data: uiHtml },
        },
        toolCall({ name: 'postMessageTester', arguments: {} }),
      ],
    ])
  }`,
})

export const testingTools = [postMessageTester, testSecretStore]
