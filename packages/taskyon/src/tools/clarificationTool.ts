import type { JSONSchema7 } from 'json-schema'
import z from 'zod'

export const CLARIFICATION_TOOL_NAME = 'askClarifyingQuestions'

export const ClarificationOption = z
  .object({
    label: z.string().min(1),
    description: z.string().optional(),
  })
  .strict()

export const ClarificationQuestion = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    options: z.array(ClarificationOption).min(2).max(5),
  })
  .strict()

export type ClarificationQuestion = z.infer<typeof ClarificationQuestion>

export const ClarificationRequest = z
  .object({
    intro: z.string().optional(),
    questions: z.array(ClarificationQuestion).min(1).max(5),
  })
  .strict()

export type ClarificationRequest = z.infer<typeof ClarificationRequest>

export type ClarificationAnswer = {
  id: string
  question: string
  answer: string
}

export type ClarificationResult = {
  intro?: string
  instruction?: string
  answers: ClarificationAnswer[]
}

export const CLARIFICATION_RESULT_INSTRUCTION =
  'Use these answers as decisions. Continue with the requested work using practical defaults; ask another question only if a blocking contradiction remains.'

export const clarificationToolParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intro: {
      type: 'string',
      description:
        'Optional one-sentence context explaining why these questions are needed before work starts.',
    },
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      description:
        'Clarifying questions to ask before starting. Use 4-5 questions for ambiguous project work and fewer only when fewer are genuinely needed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'question', 'options'],
        properties: {
          id: {
            type: 'string',
            description: 'Stable short id for the answer, such as scope or runtime.',
          },
          question: {
            type: 'string',
            description: 'The concise question shown to the user.',
          },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 5,
            description:
              'Multiple-choice answers. Include practical defaults; the UI also lets the user type a custom answer.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label'],
              properties: {
                label: {
                  type: 'string',
                  description: 'Short selectable answer label.',
                },
                description: {
                  type: 'string',
                  description: 'Optional short explanation of the tradeoff.',
                },
              },
            },
          },
        },
      },
    },
  },
  required: ['questions'],
} as const satisfies JSONSchema7

export const clarificationToolDescription =
  'Ask the user structured clarifying questions before starting ambiguous work.'

export const clarificationToolLongDescription = [
  'Use this as an early first step only when the user request leaves important choices unclear.',
  'Ask 4-5 compact multiple-choice questions for ambiguous project work, with practical defaults.',
  'Do not use it when the request is already executable, when reasonable defaults are obvious, or during autonomous benchmark proof runs unless the ambiguity would make success impossible.',
  'Each question must include options; the UI also allows a custom typed answer.',
].join(' ')

export function formatClarificationAnswersAsUserMessage(result: ClarificationResult): string {
  const lines = ['Clarification answers:']
  for (const answer of result.answers) {
    lines.push(`- ${answer.question}: ${answer.answer}`)
  }
  return lines.join('\n')
}
