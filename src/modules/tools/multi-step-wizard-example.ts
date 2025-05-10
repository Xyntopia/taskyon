// TODO: create a "multiStepTool" function which abstracts the steps below
//       - use a list of functions to automatically create the steps and properties

import { craeteToolJsonSchema, createTool, createToolTask, makeTaskResult } from '../taskyon/tools'
import { dump } from 'js-yaml'
import { TaskProcessingError, ToolBase } from '../taskyon/types'
import { match, P } from 'ts-pattern'
import type { taskResult } from '../taskyon/tools'
import { createChatCompletionTask } from './chatCompletionTool'

//       - with match & P.select & returning of the correct functions...
export const toolCreationWizard = createTool({
  parameters: {
    type: 'object',
    properties: {
      step: {
        type: 'string',
        enum: ['start', 'parsing'],
        description: 'Use "start" if we want to create a new tool...',
      },
    },
  } as const,
  // TODO: add an option to search for similar tools first...
  // TODO: use "P" from ts-match to automatically select the correct steps etc...
  function: ({ step }, { taskChain }) =>
    match(step)
      .returnType<taskResult | Promise<taskResult>>()
      // "undefined" is the first step and how we start :)
      .with(P.union(P.nullish, P.string.includes('init'), P.string.includes('start')), () => {
        console.log('starting function creation wizard')
        console.log('Prompting for tool creation...')

        const toolJsonSchema = craeteToolJsonSchema()

        return makeTaskResult([
          [
            {
              role: 'assistant',
              content: {
                type: 'message',
                data: 'I am gathering examples from tools with code for the tool requested by the user...',
              },
            },
            createToolTask({
              name: 'toolSearcher',
              arguments: { withCode: true, analyze: false },
            }),
            createChatCompletionTask({
              prompts: [
                `You need to retrieve examples of existing tools in order to help you creating a new tool.
From the list of tools you extracted earlier, which tool is the one closest to what the user would like to have?`,
              ],
              goal: 'SimpleCompletion',
            }),
            createChatCompletionTask({
              prompts: [
                `- Use the toolSearcher function again. You are required to use it.
- Use the name you selected for the "toolName" argument in the "toolSearcher" tool`,
              ],
              allowedTools: ['toolSearcher'],
              goal: 'ChooseTool',
            }),
            {
              role: 'system',
              content: {
                type: 'message',
                data: `The required json schema for creating a tool looks like this:
                ${dump(toolJsonSchema)}`,
              },
            },
            createChatCompletionTask({
              prompts: [
                `Now, with the examples given to you, can you create a new tool?. Please make
    sure to give your response in yaml format. No comments, no surrounding text.
    Just pure yaml which we can parse. make sure that you follow the schema you
    were given for this.`,
              ],
              schema: toolJsonSchema,
            }),
            {
              role: 'function',
              content: {
                type: 'functioncall',
                data: { name: 'toolCreationWizard', arguments: { step: 'parsing' } },
              },
            },
          ],
        ])
      })
      .with('parsing', () => {
        console.log('Parsing the tool creation input...', taskChain.at(-1))

        const lastMessage = taskChain.at(-1)

        const toolDef = ToolBase.parse(lastMessage?.content.data)

        console.log('finished parsing new tool...', toolDef)

        return makeTaskResult([
          [
            {
              role: 'assistant',
              content: { type: 'message', data: 'I created this new tool:' },
            },
            {
              role: 'assistant',
              content: { type: 'tooldefinition', data: toolDef },
            },
          ],
        ])
      })
      .otherwise(() => {
        console.log('no state spcifi')
        throw new TaskProcessingError(
          `The tool doesn't know what to do with this step... available steps are: 'parsing', if you are just starting, don't specify any parameters... `,
        )
      }),
  description: 'Multi-step tool example.',
  longDescription: `A multi-step wizard that assists an LLM in creating new tool definitions.
It leverages examples from existing tools—including their source code when available—to
 guide the LLM through generating a new tool. Starting with schema creation and example
 retrieval, the wizard then prompts for a complete YAML-formatted tool definition.
 Use this tool to streamline and standardize the creation of new tools.`,
  name: 'toolCreationWizard',
})

export const issueListGenerator = createTool({
  name: 'issueListGenerator',
  description:
    'Converts a text message into a list of issues and then generates a UI for review and GitLab submission.',
  longDescription: `TODO...`,
  parameters: {
    type: 'null',
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
