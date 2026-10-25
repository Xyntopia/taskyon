import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaskSelectionRoute } from './taskSelectionUrl'

void test('completed public-chat import removes the external source URL', () => {
  const source = 'https://example.com/shared.md'
  const href = `https://taskyon.space/chat?url=${encodeURIComponent(source)}`
  assert.equal(buildTaskSelectionRoute(href, 'local-task'), '/chat?t=local-task')
})

void test('hash router public-chat import clears the source but keeps local task identity', () => {
  const href = 'https://taskyon.space/#/chat?url=https%3A%2F%2Fexample.com%2Fshare.md'
  assert.equal(buildTaskSelectionRoute(href, 'local-task'), '/chat?t=local-task')
})

void test('ordinary task selection preserves independent query options', () => {
  const href = 'https://taskyon.space/detailed?layout=tree&search=tags'
  assert.equal(
    buildTaskSelectionRoute(href, 'local-task'),
    '/detailed?layout=tree&search=tags&t=local-task',
  )
})
