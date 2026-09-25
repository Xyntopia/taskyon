import { politeFetch } from '../utils/politeHttp'

export const testPoliteFetchUsesInjectedHostFetch = async () => {
  let requested = ''
  const response = await politeFetch(
    'https://example.com/page',
    undefined,
    { minDelayMs: 0 },
    (input) => {
      requested = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return Promise.resolve(new Response('mediated'))
    },
  )
  if (requested !== 'https://example.com/page' || (await response.text()) !== 'mediated') {
    throw new Error('Polite HTTP must use the injected host fetch')
  }
  return { success: true }
}
