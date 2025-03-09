import { match, P } from 'ts-pattern'
import type { taskResult } from '../taskyon/tools'
import { createTool, makeTaskResult } from '../taskyon/tools'
import { TaskProcessingError } from '../taskyon/types'
import { createChatCompletionTask } from './chatCompletionTool'

const issueListGenerator = createTool({
  name: 'issueListGenerator',
  description:
    'Converts a text message into a list of issues and then generates a UI for review and GitLab submission.',
  longDescription: `TODO...`,
  parameters: {
    type: 'object',
    properties: {},
  } as const,
  function: (params, { taskChain }) =>
    // use pattern matching on the last task
    match(taskChain.at(-1))
      .returnType<taskResult>()
      .with({ content: { data: P.string.length(100) } }, () => {
        console.log('Step "start": Converting text to issue list...')
        return makeTaskResult([
          [
            {
              role: 'assistant',
              content: {
                type: 'message',
                data: 'Converting the text to a list of issues which we can upload to a service!',
              },
            },
            createChatCompletionTask({
              prompts: [
                `Extract a list of issues from the text which we could use
in gitlab or github. They should roughly follow the style of a "user story". Here is the text
Text: {message}`,
              ],
              schema: {
                type: 'array',
                items: {
                  type: 'string',
                },
              },
            }),
            {
              role: 'function',
              content: {
                type: 'functioncall',
                data: {
                  name: 'issueListGenerator',
                  arguments: { step: 'ui', issues: '<YAML_OUTPUT>' },
                },
              },
            },
          ],
        ])
      })
      .with(
        { content: { type: 'structured', data: P.array(P.string) } },
        ({ content: { data: issueList } }) => {
          console.log('Step "ui": Generating UI from YAML list of issues.')
          const uiHtml = `<div>
  <ul>
    ${issueList.map((issue) => `<li><input type="checkbox" /> ${issue}</li>`).join('\n')}
  </ul>
  <button onclick="uploadIssues()">Submit</button>
</div>`
          return makeTaskResult([
            [
              {
                role: 'assistant',
                content: {
                  type: 'message',
                  data: uiHtml,
                },
              },
            ],
          ])
        },
      )
      .otherwise(() => {
        throw new TaskProcessingError('We can not process the previous task!')
      }),
})

export const devTools = [issueListGenerator]
