import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import type { TaskNode } from '../../../taskyon/src/types/taskNode'
import type { AddressInfo } from 'node:net'
import {
  countDelegatedSubtaskToolCalls,
  renderTaskProgress,
  renderWorkerProgress,
  resolveWorkerStatusText,
} from '../cli/taskRenderer'

type SessionStep = {
  delayMs?: number
  failOn?: string[]
  input: string
  waitFor?: string
  signal?: NodeJS.Signals
}

type SessionResult = {
  code: number | null
  output: string
}

export type CliE2eSessionLog = {
  testName: string
  label: string
  command: string
  args: string[]
  code: number | null
  output: string
}

const WAIT_AFTER_STEPS_MS = 500
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const TYCLI_RUN_COMMAND = process.env.TYCLI_E2E_COMMAND ?? 'yarn tycli'
const TEST_HOME = '/tmp/tycli-e2e-home'
const DEFAULT_E2E_CWD = process.env.TYCLI_E2E_CWD ?? REPO_ROOT
const TYCLI_PACKAGE_CWD = fileURLToPath(new URL('../..', import.meta.url))
const sessionLogs: CliE2eSessionLog[] = []

export function clearCliE2eSessionLogs() {
  sessionLogs.length = 0
}

export function getCliE2eSessionLogs() {
  return [...sessionLogs]
}

clearCliE2eSessionLogs.helper = true
getCliE2eSessionLogs.helper = true

async function findExecutableInPath(name: string): Promise<string | null> {
  const pathValue = process.env.PATH ?? ''
  for (const dir of pathValue.split(':').filter(Boolean)) {
    const candidate = join(dir, name)
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // continue
    }
  }
  return null
}

async function resolveScriptBinary(): Promise<string> {
  const fromPath = await findExecutableInPath('script')
  if (fromPath) return fromPath

  const fixedCandidates = [
    '/run/current-system/sw/bin/script', // NixOS system profile
    '/usr/bin/script',
    '/bin/script',
  ]
  for (const candidate of fixedCandidates) {
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // continue
    }
  }
  throw new Error(
    'Could not find executable "script" in PATH or known locations (/run/current-system/sw/bin, /usr/bin, /bin).',
  )
}

async function resolveShellBinary(): Promise<string> {
  const shell = process.env.SHELL
  if (shell) {
    try {
      await access(shell, fsConstants.X_OK)
      return shell
    } catch {
      // continue
    }
  }
  const fromPath = await findExecutableInPath('bash')
  if (fromPath) return fromPath
  const shFromPath = await findExecutableInPath('sh')
  if (shFromPath) return shFromPath
  return 'sh'
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForText(
  readOutput: () => string,
  needle: string,
  timeoutMs: number,
  failOn: string[] = [],
  isClosed?: () => boolean,
  fromIndex = 0,
): Promise<number> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const output = readOutput()
    const remainingOutput = output.slice(fromIndex)
    const failedMatch = failOn.find((entry) => remainingOutput.includes(entry))
    if (failedMatch) {
      throw new Error(`Saw failure output "${failedMatch}" while waiting for "${needle}".`)
    }
    const matchIndex = remainingOutput.indexOf(needle)
    if (matchIndex >= 0) return fromIndex + matchIndex + needle.length
    if (isClosed?.()) {
      throw new Error(`CLI exited while waiting for output "${needle}".\nOutput:\n${output}`)
    }
    await delay(50)
  }
  throw new Error(`Timed out waiting for output "${needle}".\nOutput:\n${readOutput()}`)
}

export async function runCliE2eSession(args: {
  testName: string
  steps: SessionStep[]
  runCommand?: string
  cwd?: string
  acceptOutputAsExit?: string
  homeKey?: string
  timeoutMs?: number
  env?: Record<string, string>
  cliArgs?: string[]
  runner?: 'pty' | 'pipe'
  isolateHome?: boolean
}): Promise<SessionResult> {
  const {
    testName,
    steps,
    runCommand = TYCLI_RUN_COMMAND,
    cwd,
    acceptOutputAsExit,
    homeKey,
    timeoutMs = 20_000,
    env,
    cliArgs = [],
    runner = 'pty',
    isolateHome = true,
  } = args
  const launchAttempts =
    runner === 'pty'
      ? await (async () => {
          const scriptPath = await resolveScriptBinary()
          const shellPath = await resolveShellBinary()
          return [
            {
              label: `direct script (${scriptPath})`,
              command: scriptPath,
              args: [
                '-qfec',
                [runCommand, ...cliArgs.map((arg) => JSON.stringify(arg))].join(' '),
                '/dev/null',
              ],
            },
            {
              label: `shell script fallback (${shellPath})`,
              command: shellPath,
              args: [
                '-lc',
                `exec "${scriptPath}" -qfec ${JSON.stringify(
                  [runCommand, ...cliArgs.map((arg) => JSON.stringify(arg))].join(' '),
                )} /dev/null`,
              ],
            },
          ]
        })()
      : runCommand === TYCLI_RUN_COMMAND
        ? [
            {
              label: 'direct node',
              command: (await findExecutableInPath('node')) || 'node',
              args: [
                '--import',
                './src/register.ts',
                '--experimental-strip-types',
                './src/taskyonCli.ts',
                ...cliArgs,
              ],
              cwd: TYCLI_PACKAGE_CWD,
            },
          ]
        : [
            {
              label: 'direct command',
              command: await resolveShellBinary(),
              args: [
                '-lc',
                `exec ${runCommand} ${cliArgs.map((arg) => JSON.stringify(arg)).join(' ')}`.trim(),
              ],
            },
          ]

  let lastLaunchError: unknown
  for (const attempt of launchAttempts) {
    try {
      return await runSpawnedSession({
        attempt,
        testName,
        steps,
        ...(acceptOutputAsExit ? { acceptOutputAsExit } : {}),
        ...(homeKey ? { homeKey } : {}),
        timeoutMs,
        isolateHome,
        ...(cwd ? { cwd } : {}),
        ...(env ? { env } : {}),
      })
    } catch (error) {
      lastLaunchError = error
      const code = (error as NodeJS.ErrnoException).code
      const message = error instanceof Error ? error.message : String(error)
      if (code !== 'ENOENT' && !message.includes('Failed to start test runner')) throw error
    }
  }

  throw lastLaunchError instanceof Error ? lastLaunchError : new Error(String(lastLaunchError))
}

runCliE2eSession.helper = true

async function withMockOverpassServer<T>(run: (url: string) => Promise<T>): Promise<T> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        elements: [
          {
            type: 'node',
            id: 1,
            lat: 52.521,
            lon: 13.4094,
            tags: { name: 'Cafe Alexanderplatz', amenity: 'cafe' },
          },
          {
            type: 'node',
            id: 2,
            lat: 52.5263,
            lon: 13.4112,
            tags: { name: 'Cafe Rosa Luxemburg', amenity: 'cafe' },
          },
        ],
      }),
    )
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    return await run(`http://127.0.0.1:${address.port}/api/interpreter`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

async function runSpawnedSession(args: {
  attempt: { label: string; command: string; args: string[]; cwd?: string }
  testName: string
  steps: SessionStep[]
  acceptOutputAsExit?: string
  homeKey?: string
  timeoutMs: number
  isolateHome: boolean
  cwd?: string
  env?: Record<string, string>
}): Promise<SessionResult> {
  const {
    attempt,
    testName,
    steps,
    acceptOutputAsExit,
    homeKey,
    timeoutMs,
    isolateHome,
    cwd,
    env,
  } = args
  const testHome = join(TEST_HOME, (homeKey ?? testName).replace(/[^a-zA-Z0-9._-]/g, '_'))
  return await new Promise((resolve, reject) => {
    const child = spawn(attempt.command, attempt.args, {
      cwd: cwd ?? attempt.cwd ?? DEFAULT_E2E_CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(isolateHome
          ? {
              HOME: testHome,
              XDG_CONFIG_HOME: join(testHome, '.config'),
            }
          : {}),
        TYCLI_TERMINAL_UI: 'none',
        ...(env ?? {}),
      },
    })

    let output = ''
    let done = false
    let stepsCompleted = false
    let closedCode: number | null = null
    const recordSession = (code: number | null) => {
      sessionLogs.push({
        testName,
        label: attempt.label,
        command: attempt.command,
        args: attempt.args,
        code,
        output,
      })
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      child.kill('SIGTERM')
      recordSession(null)
      reject(new Error(`CLI test timed out after ${timeoutMs}ms.\nOutput:\n${output}`))
    }, timeoutMs)

    const finish = (code: number | null) => {
      if (done) return
      closedCode = code
      if (!stepsCompleted) return
      done = true
      clearTimeout(timer)
      recordSession(code)
      resolve({ code, output })
    }
    const tryAcceptOutputAsExit = () => {
      if (done || !stepsCompleted || closedCode !== null) return
      if (!acceptOutputAsExit || !output.includes(acceptOutputAsExit)) return
      child.kill('SIGTERM')
      done = true
      clearTimeout(timer)
      recordSession(0)
      resolve({ code: 0, output })
    }

    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8')
      tryAcceptOutputAsExit()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8')
      tryAcceptOutputAsExit()
    })
    child.on('error', (error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const e = new Error(
          `Failed to start test runner via ${attempt.label}: ${error.message}. PATH=${process.env.PATH ?? ''}`,
        ) as NodeJS.ErrnoException
        e.code = 'ENOENT'
        reject(e)
        return
      }
      reject(error)
    })
    child.stdin.on('error', (error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      recordSession(closedCode)
      reject(
        new Error(
          `Failed to write to CLI stdin: ${error instanceof Error ? error.message : String(error)}.\nOutput:\n${output}`,
        ),
      )
    })
    child.on('close', (code) => finish(code))
    ;(async () => {
      let outputOffset = 0
      for (const step of steps) {
        if (closedCode !== null) {
          throw new Error(
            `CLI exited before test steps completed (code ${String(closedCode)}).\nOutput:\n${output}`,
          )
        }
        if (step.waitFor) {
          outputOffset = await waitForText(
            () => output,
            step.waitFor,
            timeoutMs,
            step.failOn,
            () => closedCode !== null,
            outputOffset,
          )
        }
        if (step.signal) {
          child.kill(step.signal)
          if (step.delayMs) await delay(step.delayMs)
          continue
        }
        if (step.delayMs) await delay(step.delayMs)
        child.stdin.write(step.input)
      }
      await delay(WAIT_AFTER_STEPS_MS)
      stepsCompleted = true
      tryAcceptOutputAsExit()
      if (done) return
      child.stdin.end()
      if (closedCode !== null) {
        done = true
        clearTimeout(timer)
        recordSession(closedCode)
        resolve({ code: closedCode, output })
      }
    })().catch((error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      recordSession(closedCode)
      const message = error instanceof Error ? error.message : String(error)
      reject(new Error(`${message}\nOutput:\n${output}`))
    })
  })
}

function assertContains(output: string, pattern: string) {
  if (!output.includes(pattern)) {
    const excerpt = output.slice(-3000)
    throw new Error(`Expected output to include "${pattern}". Output excerpt:\n${excerpt}`)
  }
}

function assertNotContains(output: string, pattern: string) {
  if (output.includes(pattern)) {
    const excerpt = output.slice(-3000)
    throw new Error(`Expected output not to include "${pattern}". Output excerpt:\n${excerpt}`)
  }
}

export async function testCliStartupShowsVersionCommitAndBuildDate() {
  const result = await runCliE2eSession({
    testName: 'testCliStartupShowsVersionCommitAndBuildDate',
    steps: [{ waitFor: 'Slash commands:', input: '/exit\n' }],
    env: { TYCLI_HOTKEY_MENUS: '0' },
  })
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
  assertContains(result.output, 'tycli 0.1.0')
  assertContains(result.output, 'tycli log: /tmp/tycli/tycli_')
  assertContains(result.output, 'Conversation storage:')
  assertContains(result.output, 'tycli ready.')
  assertContains(result.output, '| idle]')
}

export async function testTerminalKitFooterOptInStartsAndExits() {
  const result = await runCliE2eSession({
    testName: 'testTerminalKitFooterOptInStartsAndExits',
    steps: [{ waitFor: 'Slash commands:', input: '/exit\n' }],
    env: { TYCLI_HOTKEY_MENUS: '0', TYCLI_TERMINAL_UI: 'terminal-kit' },
    runner: 'pty',
  })
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
  assertContains(result.output, 'tycli ready.')
  assertContains(result.output, 'No conversation saved: no messages.')
  assertNotContains(result.output, 'Fatal error')
}

export function testTaskRendererDoesNotEchoUserPromptInput() {
  const lines = ['[chatgpt-codex | gpt-5.4 | processing:1]']
  const userTask: TaskNode = {
    id: 'user-task',
    role: 'user',
    content: {
      type: 'message',
      data: 'already echoed by readline',
    },
  }
  const assistantTask: TaskNode = {
    id: 'assistant-task',
    role: 'assistant',
    content: {
      type: 'message',
      data: 'assistant response',
    },
  }
  const functionTask: TaskNode = {
    id: 'function-task',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'clock', arguments: {} },
    },
  }
  const state = {
    debugEnabled: () => false,
    showRoleTag: () => true,
    showFullFunctionResults: () => false,
    isFunctionHiddenInChat: () => false,
    clearThinkingPanel: () => {},
    renderThinkingPanel: () => {},
    writeLine: (text: string) => {
      lines.push(text)
    },
  }

  renderTaskProgress(state, userTask, false)
  renderTaskProgress(state, functionTask, false)
  renderTaskProgress(state, assistantTask, false)

  const output = stripVTControlCharacters(lines.join('\n'))
  assertNotContains(output, 'already echoed by readline')
  assertContains(output, 'assistant response')
  assertContains(output, '[chatgpt-codex | gpt-5.4 | processing:1]\n\n[function|functioncall]')
}

export async function testTaskRendererWritesHtmlPreviewForAssistantHtml() {
  const lines: string[] = []
  const assistantTask: TaskNode = {
    id: 'assistant-html-task',
    role: 'assistant',
    content: {
      type: 'message',
      data: '<div><strong>Map widget</strong><iframe src="https://example.test/map"></iframe></div>',
    },
  }
  const state = {
    debugEnabled: () => false,
    showRoleTag: () => true,
    showFullFunctionResults: () => false,
    isFunctionHiddenInChat: () => false,
    clearThinkingPanel: () => {},
    renderThinkingPanel: () => {},
    writeLine: (text: string) => {
      lines.push(text)
    },
  }

  renderTaskProgress(state, assistantTask, false)

  const output = stripVTControlCharacters(lines.join('\n'))
  assertContains(output, 'HTML preview: file://')
  assertNotContains(output, '<iframe src="https://example.test/map"></iframe>')
  const previewUrl = /HTML preview: (file:\/\/\S+)/.exec(output)?.[1]
  if (!previewUrl) throw new Error(`Expected HTML preview URL in output:\n${output}`)

  const previewHtml = await readFile(fileURLToPath(previewUrl), 'utf8')
  assertContains(previewHtml, '<!doctype html>')
  assertContains(previewHtml, '<strong>Map widget</strong>')
  assertContains(previewHtml, '<iframe src="https://example.test/map"></iframe>')
}

export async function testCliOverpassMapToolPrintsHtmlPreviewLink() {
  await withMockOverpassServer(async (overpassUrl) => {
    const result = await runCliE2eSession({
      testName: 'testCliOverpassMapToolPrintsHtmlPreviewLink',
      cliArgs: [
        'client',
        'callTool',
        'overpassMapTool',
        JSON.stringify({
          overpassQuery:
            '[out:json][timeout:25];node["amenity"="cafe"](around:300,52.5208,13.4095);out tags center geom;',
        }),
      ],
      steps: [
        {
          waitFor: 'HTML preview: file://',
          failOn: ['Fatal error', '[system|error]', "Tool 'overpassMapTool' failed"],
          input: '',
        },
      ],
      env: {
        TASKYON_OVERPASS_INTERPRETER_URL: overpassUrl,
        TYCLI_HOTKEY_MENUS: '0',
      },
      runner: 'pipe',
      timeoutMs: 90_000,
    })

    if (result.code !== 0) {
      throw new Error(`Expected tycli exit code 0, got ${String(result.code)}.\n${result.output}`)
    }
    assertContains(result.output, 'HTML preview: file://')
    assertNotContains(result.output, 'taskyon-world-pmtiles')

    const previewUrl = /HTML preview: (file:\/\/\S+)/.exec(result.output)?.[1]
    if (!previewUrl) throw new Error(`Could not find preview URL.\n${result.output}`)
    const previewHtml = await readFile(fileURLToPath(previewUrl), 'utf8')
    assertContains(previewHtml, 'taskyon-world-pmtiles')
    assertContains(previewHtml, 'Cafe Alexanderplatz')
    assertContains(previewHtml, 'Cafe Rosa Luxemburg')
  })
}

export async function testCliClarificationToolAcceptsTypedAnswers() {
  const args = {
    intro: 'Clarification example',
    questions: [
      {
        id: 'project',
        question: 'Which GitLab project should I inspect?',
        options: [
          { label: 'Taskyon frontend', description: 'Use the frontend application project.' },
          { label: 'Taskyon API', description: 'Use the backend API project.' },
        ],
      },
      {
        id: 'criteria',
        question: 'What should count as obsolete?',
        options: [
          { label: 'Closed elsewhere', description: 'Issues already replaced or completed.' },
          { label: 'No activity', description: 'Issues with no recent activity.' },
        ],
      },
    ],
  }
  const result = await runCliE2eSession({
    testName: 'testCliClarificationToolAcceptsTypedAnswers',
    steps: [
      {
        waitFor: 'Slash commands:',
        input: `/client callTool askClarifyingQuestions ${JSON.stringify(args)}\n`,
      },
      {
        waitFor: '3. Custom answer',
        failOn: ['[Max depth reached]', 'askClarifyingQuestions: processing'],
        input: '2\n',
      },
      {
        waitFor: '1. Closed elsewhere - Issues already replaced or completed.',
        failOn: ['[Max depth reached]', 'askClarifyingQuestions: processing'],
        input: '3\n',
      },
      {
        waitFor: 'Custom answer:',
        failOn: ['[Max depth reached]', 'askClarifyingQuestions: processing'],
        input: 'Older than one year and superseded by another issue\n',
      },
      {
        waitFor: '[system|toolresult]',
        failOn: ['[Max depth reached]', 'askClarifyingQuestions: processing', 'Fatal error'],
        input: '',
      },
    ],
    acceptOutputAsExit: '[system|toolresult]',
    env: { TYCLI_HOTKEY_MENUS: '0' },
    runner: 'pty',
    timeoutMs: 60_000,
  })

  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
  assertContains(result.output, 'Select:')
  assertContains(result.output, 'Taskyon API - Use the backend API project.')
  assertContains(result.output, 'Older than one year and superseded by another issue')
  assertContains(result.output, 'Use these answers as decisions.')
  assertNotContains(result.output, '[Max depth reached]')
  assertNotContains(result.output, 'askClarifyingQuestions: processing')
}

export function testTaskRendererDoesNotPrintTransientWorkerProgress() {
  const lines: string[] = []
  const state = {
    debugEnabled: () => false,
    showRoleTag: () => true,
    showFullFunctionResults: () => false,
    isFunctionHiddenInChat: () => false,
    clearThinkingPanel: () => {},
    renderThinkingPanel: () => {},
    writeLine: (text: string) => {
      lines.push(text)
    },
  }
  const task: TaskNode = {
    id: 'tool-task',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'taskyonDocumentation', arguments: {} },
    },
  }

  renderWorkerProgress(state, { stage: 'processing', task })
  renderWorkerProgress(state, { stage: 'subtasks', task })

  const output = lines.join('\n')
  assertNotContains(output, '[function|processing]')
  assertNotContains(output, 'taskyonDocumentation')
  assertNotContains(output, '[function|waiting for subtasks]')
}

export function testTaskRendererHidesHiddenWorkerProgress() {
  const lines: string[] = []
  const state = {
    debugEnabled: () => false,
    showRoleTag: () => true,
    showFullFunctionResults: () => false,
    isFunctionHiddenInChat: (name: string) => name === 'hiddenTool',
    clearThinkingPanel: () => {},
    renderThinkingPanel: () => {},
    writeLine: (text: string) => {
      lines.push(text)
    },
  }
  const task: TaskNode = {
    id: 'hidden-tool-task',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'hiddenTool', arguments: {} },
    },
  }

  renderWorkerProgress(state, { stage: 'processing', task })

  assertNotContains(lines.join('\n'), 'hiddenTool')
}

export function testTaskRendererSummarizesHiddenFunctionCallsBeforeVisibleTask() {
  const lines: string[] = []
  const pendingHiddenNodes: string[] = []
  const state = {
    debugEnabled: () => false,
    showRoleTag: () => true,
    showFullFunctionResults: () => false,
    isFunctionHiddenInChat: (name: string) => name === 'hiddenTool',
    noteHiddenNode: (toolName: string) => {
      pendingHiddenNodes.push(toolName)
    },
    flushHiddenNodeMarkers: () => {
      if (pendingHiddenNodes.length <= 0) return
      lines.push(pendingHiddenNodes.map((toolName) => `>${toolName}`).join('\n'))
      pendingHiddenNodes.length = 0
    },
    clearThinkingPanel: () => {},
    renderThinkingPanel: () => {},
    writeLine: (text: string) => {
      lines.push(text)
    },
  }
  const hiddenTask = (id: string): TaskNode => ({
    id,
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'hiddenTool', arguments: {} },
    },
  })
  const visibleTask: TaskNode = {
    id: 'visible-tool-task',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'visibleTool', arguments: {} },
    },
  }

  for (let index = 0; index < 4; index += 1) {
    renderTaskProgress(state, hiddenTask(`hidden-${String(index)}`), false)
  }
  renderTaskProgress(state, hiddenTask('hidden-0'), true)
  renderTaskProgress(state, visibleTask, false)

  const output = stripVTControlCharacters(lines.join('\n'))
  assertContains(
    output,
    '>hiddenTool\n>hiddenTool\n>hiddenTool\n>hiddenTool\n\n[function|functioncall]',
  )
  assertNotContains(output, 'name: hiddenTool')
  if (output.split('>hiddenTool').length - 1 !== 4) {
    throw new Error(`Expected exactly four hidden tool markers. Output:\n${output}`)
  }
}

export function testDelegatedSubtaskCountsOnlyItsExecutableFunctionCalls() {
  const tasks: TaskNode[] = [
    {
      id: 'delegated-entry',
      role: 'function',
      content: {
        type: 'functioncall',
        data: {
          name: 'entryNode',
          arguments: { taskContract: { objective: 'Inspect the repository' } },
        },
      },
    },
    {
      id: 'subtask-message',
      parentID: 'delegated-entry',
      role: 'assistant',
      content: { type: 'message', data: 'Working on it' },
    },
    {
      id: 'subtask-tool',
      parentID: 'delegated-entry',
      priorID: 'subtask-message',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'bash', arguments: {} } },
    },
    {
      id: 'nested-tool',
      parentID: 'subtask-tool',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'entryNode', arguments: {} } },
    },
    {
      id: 'unrelated-tool',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'clock', arguments: {} } },
    },
  ]

  const count = countDelegatedSubtaskToolCalls('delegated-entry', tasks)
  if (count !== 3) {
    throw new Error(
      `Expected three executable calls in the delegated subtask, got ${String(count)}`,
    )
  }
  if (countDelegatedSubtaskToolCalls('unrelated-tool', tasks) !== null) {
    throw new Error('Expected a normal function call not to be classified as a delegated subtask')
  }
}

export function testWorkerStatusTextHidesHiddenTools() {
  const visibleTask: TaskNode = {
    id: 'visible-tool-task',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'visibleTool', arguments: {} },
    },
  }
  const hiddenTask: TaskNode = {
    id: 'hidden-tool-task',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'hiddenTool', arguments: {} },
    },
  }

  const isHidden = (name: string) => name === 'hiddenTool'
  const visible = resolveWorkerStatusText({ stage: 'processing', task: visibleTask }, isHidden)
  const hidden = resolveWorkerStatusText({ stage: 'processing', task: hiddenTask }, isHidden)
  const progress = resolveWorkerStatusText(
    {
      stage: 'tool progress',
      taskId: visibleTask.id,
      toolName: 'visibleTool',
      progress: { kind: 'stdout', message: 'first line\nsecond line\n' },
    },
    isHidden,
  )
  const hiddenProgress = resolveWorkerStatusText(
    {
      stage: 'tool progress',
      taskId: hiddenTask.id,
      toolName: 'hiddenTool',
      progress: { kind: 'stdout', message: 'private output' },
    },
    isHidden,
  )

  if (visible !== 'visibleTool: processing') {
    throw new Error(`Expected visible worker status text, got ${String(visible)}`)
  }
  if (hidden !== null) {
    throw new Error(`Expected hidden worker status text to be null, got ${String(hidden)}`)
  }
  if (progress !== 'visibleTool: first line second line') {
    throw new Error(`Expected one-line tool progress, got ${String(progress)}`)
  }
  if (hiddenProgress !== null) {
    throw new Error(`Expected hidden tool progress to be null, got ${String(hiddenProgress)}`)
  }
}

export async function testCliConcurrentSessionsStartWithSharedHome() {
  const runSession = (label: string) =>
    runCliE2eSession({
      testName: `testCliConcurrentSessionsStartWithSharedHome-${label}`,
      homeKey: 'testCliConcurrentSessionsStartWithSharedHome',
      steps: [{ waitFor: 'tycli ready.', failOn: ['Fatal error'], input: '/exit\n' }],
      env: { TYCLI_HOTKEY_MENUS: '0' },
      runner: 'pty',
      timeoutMs: 60_000,
    })

  const results = await Promise.all([runSession('first'), runSession('second')])
  for (const result of results) {
    if (result.code !== 0) {
      throw new Error(`Expected tycli exit code 0, got ${String(result.code)}.\n${result.output}`)
    }
    assertContains(result.output, 'tycli ready.')
    assertNotContains(result.output, 'Fatal error')
  }
}

export async function testEmptyCliSessionDoesNotCreateConversationFile() {
  const result = await runCliE2eSession({
    testName: 'testEmptyCliSessionDoesNotCreateConversationFile',
    steps: [{ waitFor: 'Slash commands:', input: '/exit\n' }],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    runner: 'pty',
  })
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
  const storageMatch = result.output.match(/Conversation storage: (.+\.md)/)
  if (!storageMatch?.[1]) {
    throw new Error(`Expected the planned conversation path in startup output.\n${result.output}`)
  }
  try {
    await access(storageMatch[1].trim(), fsConstants.F_OK)
    throw new Error(`Empty session created a conversation file: ${storageMatch[1].trim()}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Empty session created')) throw error
  }
  const configPath = join(
    TEST_HOME,
    'testEmptyCliSessionDoesNotCreateConversationFile',
    '.config',
    'tycli',
    'config.json',
  )
  const storedConfig = await readFile(configPath, 'utf8')
  assertNotContains(storedConfig, storageMatch[1].trim())
  assertContains(result.output, 'No conversation saved: no messages.')
  assertNotContains(result.output, 'Conversation saved:')
}

export async function testSlashMenuOpensOnSingleSlash() {
  const result = await runCliE2eSession({
    testName: 'testSlashMenuOpensOnSingleSlash',
    steps: [
      { waitFor: 'Slash commands:', input: '/' },
      { waitFor: 'Slash commands', input: '' },
      { delayMs: 100, input: 'exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '1' },
  })
  assertContains(result.output, 'Slash commands')
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
}

export async function testAtFileCommandAddsContextForDirectPath() {
  const result = await runCliE2eSession({
    testName: 'testAtFileCommandAddsContextForDirectPath',
    steps: [
      { waitFor: 'Slash commands:', input: '@package.json\n' },
      { waitFor: 'Added file context: package.json', input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    runner: 'pty',
  })
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
  assertContains(result.output, 'Added file context: package.json')
}

export async function testAtMenuOpensOnSingleAt() {
  const result = await runCliE2eSession({
    testName: 'testAtMenuOpensOnSingleAt',
    steps: [
      { waitFor: 'Slash commands:', input: '@\n' },
      { waitFor: 'Files (@)', input: '' },
      { delayMs: 100, input: '1\n' },
      { delayMs: 200, input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
  })
  assertContains(result.output, 'Files (@)')
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
}

export async function testIdleCtrlCShowsQuitPromptAndCanBeCancelled() {
  const result = await runCliE2eSession({
    testName: 'testIdleCtrlCShowsQuitPromptAndCanBeCancelled',
    steps: [
      { waitFor: 'Slash commands:', input: '', signal: 'SIGINT' },
      { waitFor: 'Quit tycli? (y/N)', input: 'n\n' },
      { waitFor: 'Conversation storage:', input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '1' },
    runner: 'pipe',
  })
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
  assertContains(result.output, 'Ctrl-C received.')
  assertContains(result.output, 'Quit tycli? (y/N)')
  assertContains(result.output, 'Conversation storage:')
  assertContains(result.output, 'tycli log:')
}

export async function testIdleCtrlDReportsPathsAndExits() {
  const result = await runCliE2eSession({
    testName: 'testIdleCtrlDReportsPathsAndExits',
    steps: [{ waitFor: 'Slash commands:', input: '\u0004' }],
    env: { TYCLI_HOTKEY_MENUS: '1' },
    runner: 'pty',
  })
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
  assertContains(result.output, 'Ctrl-D received.')
  assertContains(result.output, 'No conversation saved: no messages.')
  assertContains(result.output, 'Conversation storage:')
  assertContains(result.output, 'tycli log:')
}

export async function testQuitPromptCtrlCCancelsAndCtrlDExits() {
  const cases: Array<{
    name: string
    steps: Parameters<typeof runCliE2eSession>[0]['steps']
    expected: string[]
  }> = [
    {
      name: 'ctrl-d-from-main-prompt',
      steps: [{ waitFor: 'Slash commands:', input: '\u0004' }],
      expected: ['Ctrl-D', 'No conversation saved: no messages.'],
    },
    {
      name: 'ctrl-c-ctrl-d',
      steps: [
        { waitFor: 'Slash commands:', input: '\u0003' },
        { waitFor: 'Quit tycli? (y/N)', input: '\u0004' },
      ],
      expected: ['Quit tycli? (y/N)', 'No conversation saved: no messages.'],
    },
    {
      name: 'ctrl-c-n-ctrl-d',
      steps: [
        { waitFor: 'Slash commands:', input: '\u0003' },
        { waitFor: 'Quit tycli? (y/N)', input: 'n\n' },
        { delayMs: 500, input: '\u0004' },
      ],
      expected: ['Quit tycli? (y/N)', 'Ctrl-D', 'No conversation saved: no messages.'],
    },
  ]

  for (const testCase of cases) {
    const result = await runCliE2eSession({
      testName: `testQuitPromptCtrlCCancelsAndCtrlDExits:${testCase.name}`,
      steps: testCase.steps,
      env: { TYCLI_HOTKEY_MENUS: '1' },
      runner: 'pty',
      acceptOutputAsExit: 'No conversation saved: no messages.',
      timeoutMs: 30_000,
    })
    if (result.code !== 0) {
      throw new Error(
        `Expected exit code 0 for ${testCase.name}, got ${String(result.code)}\n${result.output}`,
      )
    }
    for (const expected of testCase.expected) {
      assertContains(result.output, expected)
    }
  }
}

export async function testCtrlCCancelsModelMenuAndKeepsPromptUsable() {
  const result = await runCliE2eSession({
    testName: 'testCtrlCCancelsModelMenuAndKeepsPromptUsable',
    steps: [
      { waitFor: 'Slash commands:', input: '/model\n' },
      { waitFor: 'Model menu', input: '\u0003' },
      { delayMs: 200, input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    runner: 'pty',
  })
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
  assertContains(result.output, 'Ctrl-C received.')
  assertContains(result.output, 'Menu cancelled.')
  assertContains(result.output, 'No conversation saved: no messages.')
  assertNotContains(result.output, 'Fatal error')
}

export async function testPromptHistoryCyclesPreviousInputWithArrowKeys() {
  for (const hotkeyMenus of ['0', '1']) {
    const initialResult = await runCliE2eSession({
      testName: `testPromptHistoryCyclesPreviousInputWithArrowKeys:${hotkeyMenus}:initial`,
      homeKey: `testPromptHistoryCyclesPreviousInputWithArrowKeys:${hotkeyMenus}`,
      steps: [
        { waitFor: 'Slash commands:', input: '/tools\n' },
        { waitFor: 'Active tool definitions:', input: '/exit\n' },
      ],
      env: { TYCLI_HOTKEY_MENUS: hotkeyMenus },
      runner: 'pty',
    })
    if (initialResult.code !== 0) {
      throw new Error(
        `Expected initial exit code 0 for hotkeyMenus=${hotkeyMenus}, got ${String(initialResult.code)}`,
      )
    }

    const replayResult = await runCliE2eSession({
      testName: `testPromptHistoryCyclesPreviousInputWithArrowKeys:${hotkeyMenus}:replay`,
      homeKey: `testPromptHistoryCyclesPreviousInputWithArrowKeys:${hotkeyMenus}`,
      steps: [
        { waitFor: 'Slash commands:', input: '\x1b[A\n' },
        { waitFor: 'Active tool definitions:', input: '/exit\n' },
      ],
      env: { TYCLI_HOTKEY_MENUS: hotkeyMenus },
      runner: 'pty',
    })
    if (replayResult.code !== 0) {
      throw new Error(
        `Expected replay exit code 0 for hotkeyMenus=${hotkeyMenus}, got ${String(replayResult.code)}`,
      )
    }
    if (!replayResult.output.includes('Active tool definitions:')) {
      throw new Error(
        `Expected Up+Enter to replay persisted /tools for hotkeyMenus=${hotkeyMenus}.\n${replayResult.output}`,
      )
    }
    assertNotContains(replayResult.output, '^[[A')
  }
}

export async function testResumeConversationReportsStorageAndLogs() {
  const testHome = join(TEST_HOME, 'testResumeConversationReportsStorageAndLogs')
  const conversationPath = join(testHome, 'fixture-conversation.md')
  await mkdir(testHome, { recursive: true })
  await writeFile(
    conversationPath,
    'Fixture user message\n\n---\n\n<!--taskyon\nrole: assistant\n-->\n\nFixture assistant response\n',
    'utf8',
  )
  const resumeResult = await runCliE2eSession({
    testName: 'testResumeConversationReportsStorageAndLogs',
    homeKey: 'testResumeConversationReportsStorageAndLogs',
    steps: [
      { waitFor: 'Slash commands:', input: `/resume ${conversationPath}\n` },
      { waitFor: 'Imported legacy conversation', input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    runner: 'pty',
  })
  if (resumeResult.code !== 0) {
    throw new Error(`Expected resume exit code 0, got ${String(resumeResult.code)}`)
  }
  assertContains(resumeResult.output, 'Imported legacy conversation')
  assertNotContains(resumeResult.output, 'Current conversation storage:')
}

export async function testTaskInterruptReportsStatusAndPersistsConversation() {
  const result = await runCliE2eSession({
    testName: 'testTaskInterruptReportsStatusAndPersistsConversation',
    steps: [
      { waitFor: 'Slash commands:', input: 'hello\n' },
      { delayMs: 500, input: '\u0003' },
      { waitFor: 'Task interrupted.', input: '/exit\n' },
      { waitFor: 'Conversation saved:', input: '', signal: 'SIGTERM' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    timeoutMs: 45_000,
  })
  assertContains(result.output, 'Ctrl-C received.')
  assertContains(result.output, 'Stopping current worker task...')
  assertContains(result.output, 'Worker stop requested. Waiting for task cleanup...')
  assertContains(result.output, 'Task interrupted.')
  assertContains(result.output, 'Conversation storage:')
  assertContains(result.output, 'tycli log:')

  const saveMatch = result.output.match(/Conversation saved: (.+\.md)/)
  if (!saveMatch?.[1]) throw new Error(`Could not find conversation save path.\n${result.output}`)
  const filePath = saveMatch[1].trim()
  const markdown = await readFile(filePath, 'utf8')
  assertContains(markdown, 'hello')
}

export async function testBracketedPastePreservesMultilinePrompt() {
  const firstLine = 'Complete these as two separate sequential delegated tasks.'
  const secondLine = 'First, list every available tool.'
  const thirdLine = 'Second, get the current weather.'
  const textTypedAfterPaste = 'AFTER_PASTE_BEFORE_ENTER'
  const result = await runCliE2eSession({
    testName: 'testBracketedPastePreservesMultilinePrompt',
    steps: [
      {
        waitFor: 'Slash commands:',
        input: `\u001b[200~${firstLine}\r\r${secondLine}\r\r${thirdLine}\r\u001b[201~`,
      },
      { delayMs: 300, input: textTypedAfterPaste },
      { delayMs: 200, input: '\r' },
      { waitFor: 'task: processing', input: '' },
    ],
    acceptOutputAsExit: 'task: processing',
    env: { TYCLI_HOTKEY_MENUS: '0' },
    timeoutMs: 45_000,
    runner: 'pty',
  })

  const storageMatch = result.output.match(/Conversation storage: (.+\.md)/)
  if (!storageMatch?.[1]) {
    throw new Error(`Could not find conversation storage path.\n${result.output}`)
  }
  const markdown = await readFile(storageMatch[1].trim(), 'utf8')
  assertContains(result.output, '\u001b[?2004h')
  assertContains(result.output, '\u001b[?2004l')
  const renderedThirdLineCount = result.output.split(thirdLine).length - 1
  if (renderedThirdLineCount !== 1) {
    throw new Error(
      `Expected the pasted line to render once, got ${String(renderedThirdLineCount)}.\n${result.output}`,
    )
  }
  assertContains(markdown, `${firstLine}\n\n${secondLine}\n\n${thirdLine}\n${textTypedAfterPaste}`)
}

testCliStartupShowsVersionCommitAndBuildDate.description =
  'CLI startup prints version, commit, and build date'
testTerminalKitFooterOptInStartsAndExits.description =
  'Terminal Kit footer backend can be enabled without making tycli depend on it for startup'
testTaskRendererDoesNotEchoUserPromptInput.description =
  'Task renderer does not duplicate user prompt input in normal CLI output'
testBracketedPastePreservesMultilinePrompt.description =
  'Bracketed multiline paste stays in one prompt until a separate Enter submits it'
testBracketedPastePreservesMultilinePrompt.timeoutMs = 60_000
testSlashMenuOpensOnSingleSlash.description = 'Slash menu opens immediately on "/" keypress'
testAtFileCommandAddsContextForDirectPath.description =
  '@<path> adds file content to CLI context without opening picker'
testAtMenuOpensOnSingleAt.description = 'File picker opens immediately on "@" keypress'
testIdleCtrlCShowsQuitPromptAndCanBeCancelled.description =
  'Idle Ctrl+C reports the interrupt, shows paths, and allows cancelling the quit prompt'
testIdleCtrlDReportsPathsAndExits.description =
  'Idle Ctrl+D reports EOF, prints session paths, and exits cleanly'
testQuitPromptCtrlCCancelsAndCtrlDExits.description =
  'Ctrl+C and Ctrl+D combinations around the idle quit prompt stay usable and exit cleanly'
testCtrlCCancelsModelMenuAndKeepsPromptUsable.description =
  'Ctrl+C cancels the raw model menu and returns to a usable prompt'
testPromptHistoryCyclesPreviousInputWithArrowKeys.description =
  'Up and Down cycle through prior main prompt inputs, including persisted history'
testResumeConversationReportsStorageAndLogs.description =
  'Resume loads a saved markdown conversation and reports source/current storage and log paths'
testTaskInterruptReportsStatusAndPersistsConversation.description =
  'Ctrl+C during a task reports interrupt phases and persists the interrupted conversation'
testTaskInterruptReportsStatusAndPersistsConversation.timeoutMs = 45_000
testAtFileCommandAddsContextForDirectPath.experimental = true
testTerminalKitFooterOptInStartsAndExits.experimental = true
testIdleCtrlCShowsQuitPromptAndCanBeCancelled.experimental = true
testIdleCtrlCShowsQuitPromptAndCanBeCancelled.helper = true
testIdleCtrlDReportsPathsAndExits.experimental = true
testQuitPromptCtrlCCancelsAndCtrlDExits.experimental = true
testCtrlCCancelsModelMenuAndKeepsPromptUsable.experimental = true
testPromptHistoryCyclesPreviousInputWithArrowKeys.experimental = true
testResumeConversationReportsStorageAndLogs.experimental = true
testTaskInterruptReportsStatusAndPersistsConversation.experimental = true
