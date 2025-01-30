import {
  type partialTaskDraft,
  type TaskNode,
  type llmSettings,
  TaskProcessingError,
  type OnInterruptFunc,
} from './types'
import { type TyTaskManager } from './taskManager'
import { handleFunctionExecution } from './tools'
import { type AsyncQueue, makeSerializable } from '../utils'

export function useTaskWorkerController() {
  /* This class adds context to task executions during the runtime.
  We don't necessarily need to save this information in the database
  It also gives us the ability to control the task worker process

  - We can interrupt/cancel task processing
  - we can track number of error in a task chain and cancel, if too many errors appear
  - we can track other information
  - we can gracefully exist streamed tasks
  - and more..
  */
  let interrupted = true
  let interruptReason: string | null = null
  let interruptCallbacks: ((reason: string | null) => void)[] = []
  let waiting = false
  let errorCount = 0

  function interrupt(reason: string | null = null): void {
    console.log('interrupting: ', reason)
    interrupted = true
    interruptReason = reason
    interruptCallbacks.forEach((callback) => callback(reason))
  }

  function isWaiting() {
    return waiting
  }

  function setWaiting(value: boolean) {
    console.log('task worker is waiting!')
    waiting = value
  }

  function isInterrupted(): boolean {
    return interrupted
  }

  function getInterruptReason(): string | null {
    return interruptReason
  }

  function reset(full = true): void {
    interrupted = false
    interruptReason = null
    errorCount = 0
    if (full) {
      interruptCallbacks = []
    }
  }

  const onInterrupt: OnInterruptFunc = (callback) => {
    interruptCallbacks.push(callback)
  }

  return {
    interrupt,
    isInterrupted,
    getInterruptReason,
    reset,
    onInterrupt,
    isWaiting,
    setWaiting,
    increaseErrorCount: () => {
      errorCount++
    },
    getErrorCount: () => {
      return errorCount
    },
  }
}
export type TaskWorkerController = ReturnType<typeof useTaskWorkerController>

// TODO:  can we move this "down" one level ;)?
async function processTask(
  task: TaskNode,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
  allowedTools: string[],
): Promise<partialTaskDraft[][]> {
  if ('functionCall' in task.content) {
    // calculate function result
    const func = task.content.functionCall
    const tools = await taskManager.updateToolDefinitions(false)
    console.log(`Calling function ${func.name}`)
    if (tools[func.name] && !taskWorkerController.isInterrupted()) {
      const result = await handleFunctionExecution(
        func,
        tools,
        taskWorkerController.onInterrupt,
        task,
      )
      return result
    } else {
      const toolnames = JSON.stringify(allowedTools)
      throw new TaskProcessingError(
        !taskWorkerController.isInterrupted()
          ? `The function '${func.name}' is not available in tools. Please select a valid function from this list: ${toolnames}`
          : 'The function execution was cancelled by taskyon',
      )
    }
  } else {
    // if it is not a functionCall, send it to a taskplanner in order to figure out what to do next
    const newTasks: partialTaskDraft[] = [
      {
        role: 'system', // TODO: not sure, if this is the right role for this...
        content: {
          functionCall: {
            name: 'taskPlanner',
            arguments: {},
          },
        },
      },
    ]
    return [newTasks]
  }

  // get token usage for this task..
  //await addTaskCostInformation(result, task, taskManager, llmSettings, apiKey)
}

export async function runTaskWorker(
  processTasksQueue: AsyncQueue<string>,
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
) {
  console.log('entering task worker loop...')

  while (true) {
    console.log('waiting for next task!')
    let task: TaskNode | undefined = undefined
    try {
      if (taskWorkerController.isInterrupted()) {
        // in case of errors, especially if its an interrupt event we simply want to cancel everything :P
        // empty our task queue :)
        console.log('clear out task queue due to interruption')
        processTasksQueue.clear()
      }

      if (processTasksQueue.count() === 0) {
        taskWorkerController.setWaiting(true)
      }
      const taskId = await processTasksQueue.pop()
      taskWorkerController.setWaiting(false)
      if (taskWorkerController.isInterrupted()) {
        // don't process tasks anymore..  all we can do now is to wait until the user manually presses the
        // "reset" button ;)
        continue
      }

      // make sure we know from outside that the worker is active...
      console.log('processing task:', taskId)
      task = await taskManager.getTask(taskId)
      if (task && !taskWorkerController.isInterrupted()) {
        const newTasks = await processTask(
          task,
          taskManager,
          taskWorkerController,
          llmSettings.allowedTools || [],
        )

        // we make sure to identify all parent tasks from this batch, because
        // we oly want to execute the leaf tasks..
        // we can do this, because all of these tasks are newly created. this means, we don't have any
        const addTasks = (finishedTask: TaskNode) => async (taskChain: partialTaskDraft[]) => {
          const immediateExecute = taskWorkerController.isInterrupted() ? false : true
          const lastTaskId = await taskManager.addTaskChain(taskChain, finishedTask.id)
          // TODO:  this needs an overhaul..  we want to save tasks only once
          //        and have them immutable...
          //        we are doing this by leaving out task results and save the result directly as the content
          //        of a new task and not i the task itself...
          if (lastTaskId) {
            const lastTask = await taskManager.getTask(lastTaskId)
            // make sure we stop execution of the task chain if we have a termination task
            if (immediateExecute && lastTask && !('termination' in lastTask.content)) {
              // TODO: we need processTasksQueue as an argument here (not implicitly adding it to this function...)
              processTasksQueue.push(lastTaskId)
            } else {
              //save task if we don't execute it, because it is already finished :)
              console.log(`task chain finished at id ${lastTaskId}!`)
            }
          }

          // TODO: add last task to GUI by checking if our current selected task now has this child...
          // TODO: and move this somewhere else!  this function should not be in here...
          //       we could have this check by getting the callback function for new tasks in tystate...
          llmSettings.selectedTaskId = lastTaskId
        }
        const taskAdder = addTasks(task)
        void newTasks.map(taskAdder)

        // and finally save the task
        // TODO: would be good to also already save the unfinished tasks here
        //       so that we can continue them later...
        void taskManager.setTask(task, true)
      }
    } catch (error) {
      console.error('Could not complete task iteration:', error)
      taskWorkerController.increaseErrorCount()
      if (taskWorkerController.getErrorCount() >= llmSettings.maxAutonomousTasks) {
        // TODO: somehow put this into an error tasknode...
        // TODO: also add any taskWorkerController interrupt in an error tasknode..
        taskWorkerController.interrupt(
          `Too many errors occured, interrupting execution after ${taskWorkerController.getErrorCount()} errors!`,
        )
      }

      const errorTask: partialTaskDraft = {
        role: 'system',
        content: {
          error: `An error occured:\n\n\`\`\`\n${JSON.stringify(error)}\n\`\`\``,
        },
        debugging: {
          error,
        },
      }
      if (error instanceof TaskProcessingError) {
        errorTask.content = {
          //message: `An error occured: ${error.message}:\n\n${dump(error.details, { skipInvalid: true })}`,
          error: `An error occured:\n\n\`\`\`\n${error.message}${
            error.details ? ':\n\n' + JSON.stringify(makeSerializable(error.details, 7)) : ''
          }\n\`\`\``,
        }
        if (task) {
          task.debugging = {
            ...task.debugging,
            error: {
              message: error.message,
              name: error.name,
              details: error.details,
              location: 'task processing',
            },
          }
        }
      } else if (error instanceof Error) {
        errorTask.content = {
          error: `An error occured:\n\n\`\`\`\n${error.message}\n\n${JSON.stringify(error)}\n\`\`\``,
        }
        if (task) {
          task.debugging = {
            ...task.debugging,
            error: {
              message: error.message,
              stack: error.stack,
              cause: error.cause,
            },
          }
        }
      }

      const newTaskId = await taskManager.addPartialTask2Tree(errorTask, task?.id)
      // interrupt execution if interrupted flag is shown!
      // this makes sure that results are still saved, even if we stop any
      // further execution

      if (!taskWorkerController.isInterrupted()) {
        // we need processTasksQueue as an argument here!!!
        processTasksQueue.push(newTaskId)
      }
      llmSettings.selectedTaskId = newTaskId

      // TODO: run this taskWorker in a separate worker js/browser thread!
      // TODO: clean up task, create a new task with the error and  & decide if we want to try this task again!

      // if we realize that a cancellation event was sent, empty the queue and set all tasks to "Cancelled"
      /*if (!processTasksQueue.count()) {
        cancelAllTasks = false;
        cancelCurrenTask = false;
      } else if (cancelAllTasks) {
        void taskManager.updateTask(
          {
            id: taskId,
            state: 'Cancelled',
          },
          true
        );
        continue;
      }*/
    }
  }
}
