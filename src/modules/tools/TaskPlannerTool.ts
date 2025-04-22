import type { JSONSchema7 } from 'json-schema'
import { createTool } from '../taskyon/tools'

export const taskPlanner = createTool({
  name: 'taskPlanner',
  description:
    'Organizes complex tasks into groups that can be worked on independently. Use this tool only when breaking down a task into subtasks makes sense—not for simple tasks.',
  longDescription: `This tool accepts a list of groups of tasks. Each group is a series of tasks that should be completed in order.
Only use this tool when the task is complex enough to need a breakdown into multiple steps. For simple tasks, no breakdown is required.

When using this tool, please explain why it is necessary to split the task into subtasks. If you have different sets of tasks that can be done concurrently, provide each set as a separate group.
Note: This tool only supports one level of grouping. For further breakdown, use another planning step.`,
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'string' },
        },
        description:
          'A list of groups of tasks. Each inner list represents tasks that need to be done in sequence. Multiple groups indicate that these tasks can be worked on in parallel.',
      },
    },
    required: ['tasks'],
  } as const satisfies JSONSchema7,
  code: `
    async ({ tasks }) => {
      // Format each group for clarity.
      const groupsFormatted = tasks
        .map((group, index) => \`Group \${index + 1}: \${group.join(' -> ')}\`)
        .join('\\n');

      return makeTaskResult([
        [
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: \`Task Breakdown:\\n\${groupsFormatted}\`,
            },
          },
          createChatCompletionTask({
            prompts: [
              \`Review the following task breakdown:\\n\${groupsFormatted}\\nExplain why it is necessary to break this task into multiple subtasks. Confirm if the plan works or suggest improvements.\`,
            ],
            goal: 'PlanTasks',
          }),
        ],
      ]);
    }
  `,
})

export const taskOrganizationTools = [taskPlanner]
