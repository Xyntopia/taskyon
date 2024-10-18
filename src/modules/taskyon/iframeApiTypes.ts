import {
  FunctionArguments,
  ToolBase,
  partialTaskDraft,
  storedSettings,
} from './types';
import { deepPartialify, deepStrictify } from '../zodUtils';
import { z } from 'zod';

const RemoteFunctionBase = z.object({
  functionName: z.string().describe('the name of the function'),
});

export const RemoteFunctionCall = RemoteFunctionBase.extend({
  type: z
    .literal('functionCall')
    .describe('Field to indicate what kind of a message we have here.'),
  arguments: FunctionArguments.optional().describe(
    'the arguments for the function as a json object',
  ),
}).describe(
  'This type is used for sending messages with function calls between windows. E.g. from iframe to parent',
);
export type RemoteFunctionCall = z.infer<typeof RemoteFunctionCall>;

export const RemoteFunctionResponse = RemoteFunctionBase.extend({
  type: z
    .literal('functionResponse')
    .describe('Field to indicate what kind of a message we have here.'),
  response: z
    .unknown()
    .optional()
    .describe(
      'response of a FunctionCall, e.g. through postMessage with iframes.',
    ),
}).describe(
  'This type is used for sending messages with the result of a remote function call between windows. E.g. from parent to taskyon iframe',
);
export type RemoteFunctionResponse = z.infer<typeof RemoteFunctionResponse>;

export const partialTyConfiguration = deepStrictify(
  deepPartialify(
    storedSettings
      .partial()
      .describe(
        'This can be used to update the configuration through iframe, json or URL',
      ),
  ),
);
export type partialTyConfiguration = z.infer<typeof partialTyConfiguration>;

const TaskMessage = z
  .object({
    type: z
      .literal('task')
      .describe('Field to indicate what kind of a message we have here.'),
    task: partialTaskDraft,
    execute: z
      .boolean()
      .default(false)
      .describe('should the task be queued for execution?'),
    duplicateTaskName: z
      .boolean()
      .default(true)
      .describe(
        `Only add the task if a task with this name doesn't exist. We do this, because otherwise tasks get 
            added on every page-load if we configure our app through an iframe parent.`,
      ),
  })
  .describe(
    'With this message type we can send tasks to taskyon from outside, e.g. a parent to a taskyon iframe',
  );

const FunctionDescriptionMessage = ToolBase.extend({
  type: z
    .literal('functionDescription')
    .describe('Field to indicate that this is a function description message.'),
  id: z.string()
    .describe(`A unique id for the function task. Tasks with the same id "overwrite" each other. The last one
    is the relevant one. Functions will get saved as a task object with the id as their name.
    
    this is important!, Taskyon can be configured to prevent tasks from getting created if they already exist with the same name!
    this helps in making sure, that tasks & tools which we upload to taskyon on pageload don't get duplicated
    on every pageload.
    If that option is turned on, we can use this as a version string for our tasks... And every time we want
    to update our webpage with a new AI tool, we simply change the version string...
    `),
  duplicateTaskName: z
    .boolean()
    .describe(
      'we use this here in order to prevent duplicate creation of our function declaration task',
    ),
});

const tyConfigurationMessage = z.object({
  type: z
    .literal('configurationMessage')
    .describe('Field to indicate that this is a function description message.'),
  conf: partialTyConfiguration,
});

export const TaskyonMessages = z.discriminatedUnion('type', [
  RemoteFunctionCall,
  RemoteFunctionResponse,
  TaskMessage,
  FunctionDescriptionMessage,
  z
    .object({ type: z.literal('taskyonReady') })
    .describe('simple message which signals, that our API is ready!'),
  tyConfigurationMessage,
]);
export type TaskyonMessages = z.infer<typeof TaskyonMessages>;
