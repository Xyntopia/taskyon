import { generateTaskKeyWords } from '../core/taskUtils'
import { buildCreateNewTaskChain } from '../core/createNewTaskChain'
import { firstWordsTaskName, generateTaskName, textRankTaskName } from '../core/taskNaming'
import { extractCombinedKeywords, textRankTerms } from '../utils/nlp'
import type { partialTaskDraft } from '../types/taskNode'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testFirstWordsTaskNameHandlesBasicText = () => {
  const name = firstWordsTaskName('  Implement a pure TypeScript task naming helper.  ')
  assert(name === 'Implement a pure TypeScript', `Unexpected name: ${String(name)}`)
  return { name }
}

export const testFirstWordsTaskNameHandlesMarkdownAndLimits = () => {
  const name = firstWordsTaskName('# Fix `taskWorker.ts` retry loop after timeout.', {
    maxWords: 5,
    maxChars: 24,
  })
  assert(name === 'Fix taskWorker.ts', `Unexpected markdown name: ${String(name)}`)
  return { name }
}

export const testFirstWordsTaskNameReturnsNullForEmptyText = () => {
  const name = firstWordsTaskName(' \n\t ')
  assert(name === null, `Expected null for empty text, got ${String(name)}`)
  return { name }
}

export const testTextRankTermsRemoveStopWords = () => {
  const terms = textRankTerms('the and a solar battery system for the home', { maxTerms: 10 })
  const termNames = terms.map((term) => term.term)
  assert(!termNames.includes('the'), `Expected stop word removal: ${JSON.stringify(termNames)}`)
  assert(termNames.includes('solar'), `Expected meaningful term: ${JSON.stringify(termNames)}`)
  return { terms }
}

export const testTextRankTermsRankRepeatedMeaningfulTerms = () => {
  const terms = textRankTerms(
    'solar battery inverter solar battery tariff solar battery planning notes',
    {
      maxTerms: 3,
    },
  )
  const termNames = terms.map((term) => term.term)
  assert(termNames.includes('solar'), `Expected solar in top terms: ${JSON.stringify(terms)}`)
  assert(termNames.includes('battery'), `Expected battery in top terms: ${JSON.stringify(terms)}`)
  return { terms }
}

export const testTextRankTermsIgnoreSourceCode = () => {
  const terms = textRankTerms(
    [
      'Please plan a solar battery backup system for tariff optimization.',
      '```ts',
      'const authToken = user.authToken ?? fallback.authToken;',
      'function authTokenFactory(authToken: string) { return authToken; }',
      '```',
    ].join('\n'),
    { maxTerms: 5 },
  )
  const termNames = terms.map((term) => term.term)
  assert(termNames.includes('solar'), `Expected natural-language term: ${JSON.stringify(terms)}`)
  assert(
    !termNames.includes('authtoken'),
    `Expected code identifier exclusion: ${JSON.stringify(terms)}`,
  )
  return { terms }
}

export const testTextRankTaskNamePreservesFirstOccurrenceOrder = () => {
  const name = textRankTaskName(
    'battery tariff optimizer battery tariff optimizer planning report',
    {
      maxWords: 3,
    },
  )
  assert(name === 'battery tariff optimizer', `Unexpected TextRank name: ${String(name)}`)
  return { name }
}

export const testGenerateTaskNameUsesTextRank = async () => {
  const name = await generateTaskName({
    text: 'Design solar battery sizing model with solar battery cost constraints.',
    options: { mode: 'textrank', maxWords: 3 },
  })
  assert(name?.includes('solar'), `Expected TextRank task name to include solar: ${String(name)}`)
  assert(
    name?.includes('battery'),
    `Expected TextRank task name to include battery: ${String(name)}`,
  )
  return { name }
}

export const testCombinedKeywordExtractorFallsBackToTextRank = async () => {
  const keywords = await extractCombinedKeywords(
    'solar battery inverter solar battery tariff solar battery planning notes',
    { maxTerms: 3 },
  )
  assert(keywords.includes('solar'), `Expected solar keyword: ${JSON.stringify(keywords)}`)
  assert(keywords.includes('battery'), `Expected battery keyword: ${JSON.stringify(keywords)}`)
  return { keywords }
}

export const testCreateNewTaskChainUsesTextRankNameFromFirstHundredWords = () => {
  const draftTask: partialTaskDraft = {
    role: 'user',
    content: {
      type: 'message',
      data: [
        ...Array.from({ length: 20 }, () => 'solar battery tariff planning').flatMap((entry) =>
          entry.split(' '),
        ),
        ...Array.from({ length: 20 }, () => 'context'),
        ...Array.from({ length: 40 }, () => 'latekeyword'),
      ].join(' '),
    },
  }
  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask,
    mode: 'message',
  })
  const name = taskChain.at(-1)?.name
  assert(name?.includes('solar'), `Expected TextRank generated task name, got ${String(name)}`)
  assert(!name?.includes('latekeyword'), `Expected first 100 word cap, got ${String(name)}`)
  return { name }
}

export const testCreateNewTaskChainRetainsTheConversationLeaf = () => {
  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask: {
      role: 'user',
      content: { type: 'message', data: 'Continue this conversation.' },
    },
    mode: 'message',
    priorTaskId: 'conversation-leaf',
  })

  assert(
    taskChain[0]?.priorID === 'conversation-leaf',
    'Expected the first draft to retain the selected conversation leaf',
  )
}

testCreateNewTaskChainRetainsTheConversationLeaf.description =
  'Links the first unhashed UI draft to the selected conversation leaf for trusted core compilation.'

export const testGenerateTaskKeywordsDoesNotNeedPyodide = async () => {
  const task: partialTaskDraft = {
    role: 'user',
    content: {
      type: 'message',
      data: 'Replace Python keywords with local naming.',
    },
  }

  const keywords = await generateTaskKeyWords(task, [], { mode: 'textrank', maxWords: 4 })
  assert(
    keywords[0]?.includes('Python') && keywords[0]?.includes('keywords'),
    `Unexpected generated keyword: ${JSON.stringify(keywords)}`,
  )
  return { keywords }
}

testFirstWordsTaskNameHandlesBasicText.description =
  'Uses the first meaningful words for local task naming.'
testFirstWordsTaskNameHandlesMarkdownAndLimits.description =
  'Removes simple markdown syntax and respects the max character limit.'
testFirstWordsTaskNameReturnsNullForEmptyText.description = 'Returns null for empty naming input.'
testTextRankTermsRemoveStopWords.description =
  'Removes stop words before building the TextRank graph.'
testTextRankTermsRankRepeatedMeaningfulTerms.description =
  'Ranks repeated meaningful terms above surrounding filler terms.'
testTextRankTermsIgnoreSourceCode.description =
  'Ignores fenced source code when extracting TextRank terms.'
testTextRankTaskNamePreservesFirstOccurrenceOrder.description =
  'Returns selected TextRank terms in readable first-occurrence order.'
testCreateNewTaskChainUsesTextRankNameFromFirstHundredWords.description =
  'Creates local TextRank task names from the first 100 draft words.'
testGenerateTaskNameUsesTextRank.description = 'Uses local TextRank mode without network access.'
testCombinedKeywordExtractorFallsBackToTextRank.description =
  'Routes local keyword extraction through nlp.ts without requiring a vector model.'
testGenerateTaskKeywordsDoesNotNeedPyodide.description =
  'Keeps the generateTaskKeyWords compatibility wrapper independent of Pyodide.'
