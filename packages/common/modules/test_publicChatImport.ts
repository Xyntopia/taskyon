import { fetchPublicChatDocument } from './webFetching/publicChatImport'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const documentFetch =
  (response: Response | (() => Response)): ((request: Request) => Promise<Response>) =>
  () =>
    Promise.resolve(typeof response === 'function' ? response() : response)

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } })

export const testPublicChatImportDownloadsMarkdown = async () => {
  const result = await fetchPublicChatDocument(
    documentFetch(new Response('# Shared chat', { headers: { 'content-type': 'text/markdown' } })),
    'https://example.test/chat.md',
  )
  assert(result.text === '# Shared chat', `Expected the document text, got ${result.text}`)
  assert(
    result.url === 'https://example.test/chat.md',
    `Expected the final source URL, got ${result.url}`,
  )
}

testPublicChatImportDownloadsMarkdown.description =
  'Downloads a public chat document and returns its final URL and text.'

export const testPublicChatImportRejectsUnsafeTargets = async () => {
  for (const source of [
    'file:///etc/passwd',
    'ftp://example.test/chat.md',
    'javascript:alert(1)',
    'http://localhost/chat.md',
    'http://127.0.0.1/chat.md',
    'http://[::1]/chat.md',
    'http://169.254.169.254/latest/meta-data',
    'https://user:secret@example.test/chat.md',
  ]) {
    let rejected = false
    try {
      await fetchPublicChatDocument(documentFetch(new Response('# nope')), source)
    } catch {
      rejected = true
    }
    assert(rejected, `Expected the public chat import to reject ${source}`)
  }
}

testPublicChatImportRejectsUnsafeTargets.description =
  'Rejects non-HTTP schemes, credentials and private or local targets.'

export const testPublicChatImportValidatesRedirects = async () => {
  const requests: string[] = []
  const result = await fetchPublicChatDocument((request) => {
    requests.push(request.url)
    return Promise.resolve(
      request.url.endsWith('/start')
        ? redirect('/relative/chat.md')
        : new Response('# Redirected chat', { headers: { 'content-type': 'text/plain' } }),
    )
  }, 'https://example.test/start')

  assert(
    result.url === 'https://example.test/relative/chat.md',
    `Expected the relative redirect to resolve, got ${result.url}`,
  )
  assert(requests.length === 2, `Expected two requests, got ${requests.length}`)

  for (const response of [
    redirect('http://127.0.0.1/private.md'),
    new Response(null, { status: 302 }),
  ]) {
    let rejected = false
    try {
      await fetchPublicChatDocument(documentFetch(response), 'https://example.test/start')
    } catch {
      rejected = true
    }
    assert(rejected, 'Expected the public chat import to reject an unsafe or incomplete redirect')
  }

  let redirects = 0
  let limited = false
  try {
    await fetchPublicChatDocument((request) => {
      redirects += 1
      return Promise.resolve(redirect(`${new URL(request.url).pathname}-again`))
    }, 'https://example.test/loop')
  } catch {
    limited = true
  }
  assert(limited && redirects === 6, `Expected a bounded redirect chain, got ${redirects}`)
}

testPublicChatImportValidatesRedirects.description =
  'Resolves relative redirects and rejects unsafe, incomplete or unbounded chains.'

export const testPublicChatImportBoundsAndValidatesContent = async () => {
  const html = new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
  let rejected = false
  try {
    await fetchPublicChatDocument(documentFetch(html), 'https://example.test/chat')
  } catch {
    rejected = true
  }
  assert(rejected, 'Expected the public chat import to reject HTML pages')

  const oversized = new Response('x'.repeat(200), {
    headers: { 'content-type': 'text/markdown' },
  })
  rejected = false
  try {
    await fetchPublicChatDocument(documentFetch(oversized), 'https://example.test/chat.md', {
      maxBytes: 100,
    })
  } catch {
    rejected = true
  }
  assert(rejected, 'Expected the public chat import to bound the response size')

  rejected = false
  try {
    await fetchPublicChatDocument(
      documentFetch(new Response('missing', { status: 404 })),
      'https://example.test/chat.md',
    )
  } catch {
    rejected = true
  }
  assert(rejected, 'Expected the public chat import to reject failed downloads')
}

testPublicChatImportBoundsAndValidatesContent.description =
  'Rejects HTML pages, failed downloads and responses above the byte limit.'
