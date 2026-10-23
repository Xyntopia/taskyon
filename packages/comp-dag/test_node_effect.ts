import { compileDagNodeRecord, executeDagNodeRun } from './dagNodeRecordCompiler.ts'
import { defineDagNodeRecord } from './dagNodeRecord.ts'
import { projectInputReadCapability } from './projectInputSource.ts'
import { createMediatedFetch } from '@taskyon/common/modules/webFetching/mediatedFetch'

export const testDagNodeEffectDefaultsToPureAndAffectsIdentity = async () => {
  const base = {
    formatVersion: 2 as const,
    localName: 'weather',
    label: 'Weather',
    version: 1,
    localParamsSchema: { type: 'object', additionalProperties: false } as const,
    outputSchema: { type: 'number' } as const,
    runSource: 'return 1',
  }
  const pure = await defineDagNodeRecord(base)
  const source = await defineDagNodeRecord({ ...base, effect: 'source' })
  const compiledPure = compileDagNodeRecord({ record: pure, nodeById: {} })
  const compiledSource = compileDagNodeRecord({ record: source, nodeById: {} })

  if (pure.id === source.id) throw new Error('Expected source effect to change node identity.')
  if (compiledPure.effect !== 'pure') throw new Error('Expected omitted effect to default to pure.')
  if (compiledSource.effect !== 'source') throw new Error('Expected source effect to be preserved.')
  return { pureId: pure.id, sourceId: source.id }
}

testDagNodeEffectDefaultsToPureAndAffectsIdentity.description =
  'Defaults DAG nodes to pure while preserving source effect in immutable identity.'

export const testPureStoredNodeCannotFetchThroughServices = async () => {
  for (const mode of ['direct', 'policy', 'authorized', 'mediated'] as const) {
    let reads = 0
    let authorizations = 0
    const source = `async ({ services }) => await (await services.fetch('https://example.test/data')).text()`
    const base = {
      formatVersion: 2 as const,
      localName: 'effect-boundary',
      label: 'Effect boundary',
      version: 1,
      localParamsSchema: { type: 'object', properties: {}, additionalProperties: false } as const,
      outputSchema: { type: 'string' } as const,
      runSource: source,
      runCode: source,
    }
    const fetch = () => {
      reads += 1
      return Promise.resolve(new Response('observed'))
    }
    const transport = {
      ...(mode === 'mediated'
        ? {
            mediatedFetch: createMediatedFetch({
              authorize: (capability) => {
                authorizations += 1
                return Promise.resolve(
                  capability.origin === 'https://example.test' && capability.access === 'read',
                )
              },
              fetch,
            }),
          }
        : mode === 'policy'
          ? { fetchWithPolicy: fetch }
          : { fetch }),
      ...(mode === 'authorized'
        ? {
            authorizeFetch: () => {
              authorizations += 1
              return Promise.resolve(true)
            },
          }
        : {}),
    }
    const pure = compileDagNodeRecord({
      record: await defineDagNodeRecord(base),
      nodeById: {},
      ...transport,
    })
    const failures: string[] = []
    let rejected = false
    try {
      await pure.call({}).run(
        {
          nowUtcMs: 0,
          log: (message, data) => {
            if (message === 'DAG node failed') failures.push(JSON.stringify(data))
          },
        },
        { execution: { mode: 'local' } },
      )
    } catch (error) {
      rejected =
        error instanceof Error &&
        error.message.includes(pure.name) &&
        error.message.includes('pure nodes cannot fetch external data') &&
        error.message.includes("effect: 'source'") &&
        error.message.includes('declared input')
    }
    if (
      !rejected ||
      reads !== 0 ||
      authorizations !== 0 ||
      !failures.some(
        (entry) =>
          entry.includes('pure nodes cannot fetch external data') &&
          entry.includes('declared input'),
      )
    )
      throw new Error('Pure stored nodes must not bypass source capture through mediated fetch.')
    const acquired = compileDagNodeRecord({
      record: await defineDagNodeRecord({ ...base, effect: 'source' }),
      nodeById: {},
      ...transport,
      authorizeFetch: (capability) =>
        Promise.resolve(capability.origin === 'https://example.test' && capability.access === 'read'),
    })
    const result = await acquired.call({}).run(undefined, { execution: { mode: 'local' } })
    if (result.value !== 'observed' || Number(reads) !== 1)
      throw new Error('Declared acquisition nodes must retain their fetch capability.')
  }
}
testPureStoredNodeCannotFetchThroughServices.description =
  'Rejects mediated HTTP in pure stored nodes before transport, while declared acquisition nodes can read through the same injected capability.'

export const testPureDirectStoredNodeCannotFetchThroughServices = async () => {
  let reads = 0
  const run = async (effect: 'pure' | 'source') =>
    executeDagNodeRun({
      id: 'direct-effect-boundary',
      effect,
      run: async ({ services }) => await (await services.fetch('https://example.test/data')).text(),
      params: {},
      use: {},
      mediatedFetch: createMediatedFetch({
        authorize: (capability) =>
          Promise.resolve(capability.origin === 'https://example.test' && capability.access === 'read'),
        fetch: () => {
          reads += 1
          return Promise.resolve(new Response('observed'))
        },
      }),
    })
  let rejected = false
  try {
    await run('pure')
  } catch (error) {
    rejected =
      error instanceof Error && error.message.includes('pure nodes cannot fetch external data')
  }
  if (!rejected || reads !== 0)
    throw new Error('Direct pure execution must reject HTTP before transport.')
  if ((await run('source')) !== 'observed' || Number(reads) !== 1)
    throw new Error('Direct source execution must retain policy-aware HTTP.')
}
testPureDirectStoredNodeCannotFetchThroughServices.description =
  'Applies the same source-only HTTP restriction to stored functions executed directly.'

export const testSourceStoredNodeRequiresHttpAuthorization = async () => {
  const source = `async ({ services }) => await (await services.fetch('https://example.test/data')).text()`
  const record = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'source-authorization-boundary',
    label: 'Source authorization boundary',
    version: 1,
    effect: 'source',
    localParamsSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'string' },
    runSource: source,
    runCode: source,
  })
  for (const transport of ['raw', 'policy'] as const) {
    for (const permission of ['missing', 'denied', 'allowed'] as const) {
      let requests = 0
      let authorizations = 0
      const failures: string[] = []
      const fetch = () => {
        requests += 1
        return Promise.resolve(new Response('observed'))
      }
      const node = compileDagNodeRecord({
        record,
        nodeById: {},
        ...(transport === 'raw' ? { fetch } : { fetchWithPolicy: fetch }),
        ...(permission === 'missing'
          ? {}
          : {
              authorizeFetch: (capability) => {
                authorizations += 1
                return Promise.resolve(
                  permission === 'allowed' &&
                    capability.origin === 'https://example.test' &&
                    capability.access === 'read',
                )
              },
            }),
      })
      let errorMessage = ''
      try {
        const result = await node.call({}).run(
          {
            nowUtcMs: 0,
            log: (message, data) => {
              if (message === 'DAG node failed') failures.push(JSON.stringify(data))
            },
          },
          { execution: { mode: 'local' } },
        )
        if (result.value !== 'observed') throw new Error('Unexpected authorized source result.')
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
      }
      if (permission === 'allowed') {
        if (requests !== 1 || authorizations !== 1 || errorMessage)
          throw new Error('Source HTTP must pass authorization before transport.')
      } else {
        const expected =
          permission === 'missing' ? 'HTTP authorization is unavailable' : 'not authorized'
        if (
          requests !== 0 ||
          !errorMessage.includes(expected) ||
          !failures.some((message) => message.includes(expected))
        )
          throw new Error(
            `Source HTTP with ${permission} authorization must fail before transport and explain why in the execution log.`,
          )
        if (permission === 'missing' && !errorMessage.includes('host'))
          throw new Error(
            'Missing source authorization must identify the host configuration boundary.',
          )
      }
    }
  }
}
testSourceStoredNodeRequiresHttpAuthorization.description =
  'Rejects raw and policy-aware source HTTP without authorization, logs missing/denied access, and permits explicitly authorized reads.'

export const testProjectInputCapabilityRequiresSourceEffect = async () => {
  let reads = 0
  const capability = projectInputReadCapability
  const run = `async ({ services }) => await services.callCapability('${capability}', { path: 'inputs/synthetic/data.json' })`
  const base = {
    formatVersion: 2 as const,
    localName: 'file-effect-boundary',
    label: 'Project input effect boundary',
    version: 1,
    localParamsSchema: { type: 'object', properties: {}, additionalProperties: false } as const,
    outputSchema: { type: 'string' } as const,
    capabilities: [capability],
    runSource: run,
    runCode: run,
  }
  const compile = async (effect: 'pure' | 'source') =>
    compileDagNodeRecord({
      record: await defineDagNodeRecord({ ...base, effect }),
      nodeById: {},
      callCapability: () => {
        reads += 1
        return Promise.resolve('{"value":1}')
      },
    })
  let rejected = false
  try {
    await (await compile('pure')).call({}).run(undefined, { execution: { mode: 'local' } })
  } catch (error) {
    rejected =
      error instanceof Error &&
      error.message.includes('project input') &&
      error.message.includes("effect: 'source'")
  }
  if (!rejected || reads !== 0)
    throw new Error('Pure nodes must not read project files without source observation capture.')
  const result = await (await compile('source'))
    .call({})
    .run(undefined, { execution: { mode: 'local' } })
  if (result.value !== '{"value":1}' || Number(reads) !== 1)
    throw new Error('Source nodes retain their declared project-input capability.')
}
testProjectInputCapabilityRequiresSourceEffect.description =
  'Rejects project-input file observations in pure nodes while retaining declared acquisition through source nodes.'
