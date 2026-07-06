import type { Extension } from '@codemirror/state'
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'

type LspCompletionItem = {
  label?: unknown
  detail?: unknown
  documentation?: unknown
  insertText?: unknown
  textEdit?: unknown
}

type LspCompletionResponse = {
  items?: unknown
}

type LspCompletionRequest = (params: {
  source: string
  line: number
  character: number
}) => string | Promise<string>

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getInsertText(item: LspCompletionItem): string {
  const textEdit = item.textEdit
  if (textEdit && typeof textEdit === 'object' && !Array.isArray(textEdit)) {
    const maybeNewText = (textEdit as Record<string, unknown>).newText
    if (typeof maybeNewText === 'string' && maybeNewText.length > 0) return maybeNewText
  }
  const insertText = asString(item.insertText)
  if (insertText.length > 0) return insertText
  return asString(item.label)
}

function parseCompletionItems(raw: string): LspCompletionItem[] {
  try {
    const parsed = JSON.parse(String(raw)) as LspCompletionResponse | LspCompletionItem[]
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      return parsed.items as LspCompletionItem[]
    }
    return []
  } catch {
    return []
  }
}

async function requestResult(
  requestCompletion: LspCompletionRequest,
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const lineInfo = context.state.doc.lineAt(context.pos)
  const line = Math.max(0, lineInfo.number - 1)
  const character = Math.max(0, context.pos - lineInfo.from)
  const raw = await requestCompletion({
    source: context.state.doc.toString(),
    line,
    character,
  })
  const items = parseCompletionItems(raw)
  if (items.length === 0) return null
  const options: Completion[] = []
  for (const item of items) {
      const label = asString(item.label)
      if (!label) continue
      const option: Completion = {
        label,
        apply: getInsertText(item),
      }
      const detail = asString(item.detail)
      if (detail) option.detail = detail
      const info = asString(item.documentation)
      if (info) option.info = info
      options.push(option)
  }
  if (options.length === 0) return null
  return {
    from: context.pos,
    options,
    validFor: /^[_\w.]*$/,
  }
}

export function createModelicaLspCompletionExtension(
  requestCompletion: LspCompletionRequest,
): Extension {
  return autocompletion({
    override: [
      (context: CompletionContext) => {
        if (!context.explicit && !/[\w.]$/.test(context.state.sliceDoc(0, context.pos))) {
          return null
        }
        return requestResult(requestCompletion, context)
      },
    ],
  })
}
