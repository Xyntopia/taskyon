import type { JSONSchema7 } from 'json-schema'
import { createWithDefaults } from '../core/tools'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const schema = {
  type: 'object',
  required: ['requirements'],
  properties: {
    requirements: {
      type: 'object',
      required: ['budget'],
      properties: {
        budget: { type: 'number', default: 2500 },
        modes: { type: 'array', default: ['local'] },
      },
    },
    optionalGroup: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
      },
    },
  },
} as const satisfies JSONSchema7

export const testCreateWithDefaultsInitializesRequiredNestedObjects = () => {
  const result = createWithDefaults(schema)
  const requirements = result.requirements
  assert(requirements !== null && typeof requirements === 'object', 'Expected requirements object')
  assert('budget' in requirements && requirements.budget === 2500, 'Expected nested budget default')
  assert(!('optionalGroup' in result), 'Expected optional object container to remain absent')
  return result
}

export const testCreateWithDefaultsClonesMutableDefaults = () => {
  const first = createWithDefaults(schema)
  const second = createWithDefaults(schema)
  const firstRequirements = first.requirements as { modes: string[] }
  const secondRequirements = second.requirements as { modes: string[] }
  firstRequirements.modes.push('remote')
  assert(secondRequirements.modes.length === 1, 'Expected independent default arrays')
  assert(secondRequirements.modes[0] === 'local', 'Expected original schema default value')
  return { first: firstRequirements.modes, second: secondRequirements.modes }
}

testCreateWithDefaultsInitializesRequiredNestedObjects.description =
  'Creates required object containers before applying nested JSON-schema defaults.'
testCreateWithDefaultsClonesMutableDefaults.description =
  'Returns independent mutable default values for separate tool inputs.'
