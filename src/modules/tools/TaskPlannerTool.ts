import { createTool, type toolContext } from '../taskyon/tools'

// TODO: update short & long description so that an LLM AI can use this tool
// TODO: make more than 1 level of subtasks possible. so taht we immediatly create sub & subsub tasks..
export const taskPlannerTool = createTool({
  function: ({ maxSubTaskNum }, context: toolContext) => {
    console.log(`Split task into ${maxSubTaskNum} subtasks`, context)
    return ''
  },
  description:
    'This tool can be used to split up a task into sub-tasks which then get worked on each individually',
  longDescription: `TODO...`,
  name: 'taskPlanner',
  renderOptions: { hideLlm: true },
  parameters: {
    type: 'object',
    properties: {
      maxSubTaskNum: {
        type: 'integer',
        description: 'Maximum number of subtasks to create.',
        default: 5,
      },
    },
    required: [],
  } as const,
})
