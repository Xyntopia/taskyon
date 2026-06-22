import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import process from 'node:process'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import type { TaskNode } from '../../../taskyon/src/types/taskNode'
import { renderTaskProgress } from '../cli/taskRenderer'

type SessionStep = {
  delayMs?: number
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
const TYCLI_RUN_COMMAND = 'yarn workspace @taskyon/tycli run run'
const TEST_HOME = '/tmp/tycli-e2e-home'
const DEFAULT_E2E_CWD = process.env.TYCLI_E2E_CWD ?? process.cwd()
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

async function waitForText(readOutput: () => string, needle: string, timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (readOutput().includes(needle)) return
    await delay(50)
  }
  throw new Error(`Timed out waiting for output "${needle}"`)
}

async function runTycSession(args: {
  testName: string
  steps: SessionStep[]
  timeoutMs?: number
  env?: Record<string, string>
  runner?: 'pty' | 'pipe'
}): Promise<SessionResult> {
  const { testName, steps, timeoutMs = 20_000, env, runner = 'pty' } = args
  const launchAttempts =
    runner === 'pty'
      ? await (async () => {
          const scriptPath = await resolveScriptBinary()
          const shellPath = await resolveShellBinary()
          return [
            {
              label: `direct script (${scriptPath})`,
              command: scriptPath,
              args: ['-qfec', TYCLI_RUN_COMMAND, '/dev/null'],
            },
            {
              label: `shell script fallback (${shellPath})`,
              command: shellPath,
              args: [
                '-lc',
                `exec "${scriptPath}" -qfec ${JSON.stringify(TYCLI_RUN_COMMAND)} /dev/null`,
              ],
            },
          ]
        })()
      : [
          {
            label: 'direct node',
            command: (await findExecutableInPath('node')) || 'node',
            args: ['--import', './src/register.ts', '--experimental-strip-types', './src/cli.ts'],
          },
        ]

  let lastLaunchError: unknown
  for (const attempt of launchAttempts) {
    try {
      return await runSpawnedSession({
        attempt,
        testName,
        steps,
        timeoutMs,
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

async function runSpawnedSession(args: {
  attempt: { label: string; command: string; args: string[] }
  testName: string
  steps: SessionStep[]
  timeoutMs: number
  env?: Record<string, string>
}): Promise<SessionResult> {
  const { attempt, testName, steps, timeoutMs, env } = args
  return await new Promise((resolve, reject) => {
    const child = spawn(attempt.command, attempt.args, {
      cwd: DEFAULT_E2E_CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: TEST_HOME,
        XDG_CONFIG_HOME: join(TEST_HOME, '.config'),
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

    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8')
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
      for (const step of steps) {
        if (closedCode !== null) {
          throw new Error(
            `CLI exited before test steps completed (code ${String(closedCode)}).\nOutput:\n${output}`,
          )
        }
        if (step.waitFor) await waitForText(() => output, step.waitFor, timeoutMs)
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
      reject(error instanceof Error ? error : new Error(String(error)))
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
  const result = await runTycSession({
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
  const result = await runTycSession({
    testName: 'testTerminalKitFooterOptInStartsAndExits',
    steps: [{ waitFor: 'Slash commands:', input: '/exit\n' }],
    env: { TYCLI_HOTKEY_MENUS: '0', TYCLI_TERMINAL_UI: 'terminal-kit' },
    runner: 'pty',
  })
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
  assertContains(result.output, 'tycli ready.')
  assertContains(result.output, 'Conversation saved:')
  assertNotContains(result.output, 'Fatal error')
}

export function testTaskRendererDoesNotEchoUserPromptInput() {
  const lines: string[] = []
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
  renderTaskProgress(state, assistantTask, false)

  const output = lines.join('\n')
  assertNotContains(output, 'already echoed by readline')
  assertContains(output, 'assistant response')
}

export async function testSlashMenuOpensOnSingleSlash() {
  const result = await runTycSession({
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
  const result = await runTycSession({
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
  const result = await runTycSession({
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
  const result = await runTycSession({
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
  const result = await runTycSession({
    testName: 'testIdleCtrlDReportsPathsAndExits',
    steps: [{ waitFor: 'Slash commands:', input: '\u0004' }],
    env: { TYCLI_HOTKEY_MENUS: '1' },
    runner: 'pty',
  })
  if (result.code !== 0) throw new Error(`Expected exit code 0, got ${String(result.code)}`)
  assertContains(result.output, 'Ctrl-D received.')
  assertContains(result.output, 'Conversation saved:')
  assertContains(result.output, 'Conversation storage:')
  assertContains(result.output, 'tycli log:')
}

export async function testCtrlCCancelsModelMenuAndKeepsPromptUsable() {
  const result = await runTycSession({
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
  assertContains(result.output, 'Conversation saved:')
  assertNotContains(result.output, 'Fatal error')
}

export async function testPromptHistoryCyclesPreviousInputWithArrowKeys() {
  const initialResult = await runTycSession({
    testName: 'testPromptHistoryCyclesPreviousInputWithArrowKeys',
    steps: [
      { waitFor: 'Slash commands:', input: '/tools\n' },
      { waitFor: 'Active tool definitions:', input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    runner: 'pty',
  })
  if (initialResult.code !== 0) {
    throw new Error(`Expected initial exit code 0, got ${String(initialResult.code)}`)
  }

  const replayResult = await runTycSession({
    testName: 'testPromptHistoryCyclesPreviousInputWithArrowKeys',
    steps: [
      { waitFor: 'Slash commands:', input: '\x1b[A\n' },
      { waitFor: 'Active tool definitions:', input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    runner: 'pty',
  })
  if (replayResult.code !== 0) {
    throw new Error(`Expected replay exit code 0, got ${String(replayResult.code)}`)
  }
  if (!replayResult.output.includes('Active tool definitions:')) {
    throw new Error(`Expected Up+Enter to replay persisted /tools.\n${replayResult.output}`)
  }
}

export async function testResumeConversationReportsStorageAndLogs() {
  const initialResult = await runTycSession({
    testName: 'testResumeConversationReportsStorageAndLogs',
    steps: [
      { waitFor: 'Slash commands:', input: '/tools\n' },
      { waitFor: 'Active tool definitions:', input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    runner: 'pty',
  })
  if (initialResult.code !== 0) {
    throw new Error(`Expected initial exit code 0, got ${String(initialResult.code)}`)
  }
  const saveMatch = initialResult.output.match(/Conversation saved: (.+\.md)/)
  if (!saveMatch?.[1]) {
    throw new Error(`Could not find conversation save path.\n${initialResult.output}`)
  }

  const conversationPath = saveMatch[1].trim()
  const resumeResult = await runTycSession({
    testName: 'testResumeConversationReportsStorageAndLogs',
    steps: [
      { waitFor: 'Slash commands:', input: `/resume ${conversationPath}\n` },
      { waitFor: 'Current conversation storage:', input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    runner: 'pty',
  })
  if (resumeResult.code !== 0) {
    throw new Error(`Expected resume exit code 0, got ${String(resumeResult.code)}`)
  }
  assertContains(resumeResult.output, `Resumed conversation: ${conversationPath}`)
  assertContains(resumeResult.output, 'Loaded conversation log:')
  assertContains(resumeResult.output, 'Current tycli log:')
}

export async function testTaskInterruptReportsStatusAndPersistsConversation() {
  const result = await runTycSession({
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

testCliStartupShowsVersionCommitAndBuildDate.description =
  'CLI startup prints version, commit, and build date'
testTerminalKitFooterOptInStartsAndExits.description =
  'Terminal Kit footer backend can be enabled without making tycli depend on it for startup'
testTaskRendererDoesNotEchoUserPromptInput.description =
  'Task renderer does not duplicate user prompt input in normal CLI output'
testSlashMenuOpensOnSingleSlash.description = 'Slash menu opens immediately on "/" keypress'
testAtFileCommandAddsContextForDirectPath.description =
  '@<path> adds file content to CLI context without opening picker'
testAtMenuOpensOnSingleAt.description = 'File picker opens immediately on "@" keypress'
testIdleCtrlCShowsQuitPromptAndCanBeCancelled.description =
  'Idle Ctrl+C reports the interrupt, shows paths, and allows cancelling the quit prompt'
testIdleCtrlDReportsPathsAndExits.description =
  'Idle Ctrl+D reports EOF, prints session paths, and exits cleanly'
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
testCtrlCCancelsModelMenuAndKeepsPromptUsable.experimental = true
testPromptHistoryCyclesPreviousInputWithArrowKeys.experimental = true
testResumeConversationReportsStorageAndLogs.experimental = true
testTaskInterruptReportsStatusAndPersistsConversation.experimental = true
