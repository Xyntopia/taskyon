import type { Component } from 'vue'

type TaskChatPageModule = { default: Component }

let taskChatPagePromise: Promise<TaskChatPageModule> | undefined

export function loadTaskChatPage() {
  taskChatPagePromise ??= import('pages/taskyon/TaskChat.vue')
  return taskChatPagePromise
}

export function warmupTaskChatPage() {
  void loadTaskChatPage()
}
