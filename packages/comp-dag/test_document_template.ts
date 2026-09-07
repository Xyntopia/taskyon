import { parseDocumentTemplate, renderDocumentView } from './documentTemplate'
import { createStorageDagBackend } from './storageDagBackend'
import { ingestTextFile, readPinnedTextFile } from './builtIn/textFileSource'

export const testDocumentTemplateFileSourcePinsBytes = async () => {
  const records = new Map<string, unknown>()
  const storage = {
    get: (namespace: string, id: string) => Promise.resolve(records.get(`${namespace}/${id}`)),
    set: (namespace: string, id: string, value: unknown) => {
      records.set(`${namespace}/${id}`, value)
      return Promise.resolve()
    },
  }
  const pinned = await ingestTextFile('deliverables/project.md.jinja', '# Original', storage, 100)
  await ingestTextFile('deliverables/project.md.jinja', '# Edited', storage, 200)
  const original = await readPinnedTextFile(pinned, storage)
  if (original !== '# Original' || !pinned.sourceSnapshotId)
    throw new Error('A template invocation must replay pinned bytes after its file changes.')
  return { success: true }
}

export const testDocumentTemplateBoundedViewsAndIndependentCache = async () => {
  const declaration = {
    id: 'power',
    source: { invocation: 'dispatch', maxRows: 2, columns: { MW: { path: 'outputs.power' } } },
    presentation: { renderer: 'table' },
  }
  const template = '# Project\n\n```document-view\n' + JSON.stringify(declaration) + '\n```\n'
  const plan = parseDocumentTemplate(template)
  const edited = parseDocumentTemplate(template.replace('# Project', '# Project revision'))
  if (plan.views.length !== 1 || edited.views[0]?.id !== 'power')
    throw new Error('Inline views must be discoverable independently of prose.')
  const records = new Map<string, unknown>()
  const backend = createStorageDagBackend({
    get: (namespace, id) => Promise.resolve(records.get(`${namespace}/${id}`)),
    set: (namespace, id, value) => {
      records.set(`${namespace}/${id}`, value)
      return Promise.resolve()
    },
  })
  const projection = { rows: [{ MW: 10 }, { MW: 20 }], complete: false }
  const first = await renderDocumentView(plan.views[0]!, projection, backend)
  const second = await renderDocumentView(edited.views[0]!, projection, backend)
  if (
    !second.cached ||
    first.artifactHash !== second.artifactHash ||
    !first.markdown.includes('10')
  )
    throw new Error('Prose-only changes must reuse the exact rendered view artifact.')
  const renamed = {
    ...declaration,
    id: 'renamed',
    source: { ...declaration.source, invocation: 'alias' },
  }
  const renamedView = parseDocumentTemplate(
    '```document-view\n' + JSON.stringify(renamed) + '\n```',
  ).views[0]!
  const third = await renderDocumentView(renamedView, projection, backend)
  if (!third.cached || third.artifactHash !== first.artifactHash)
    throw new Error('Invocation aliases and view IDs must not invalidate identical presentation.')
  let rejected = false
  try {
    await renderDocumentView(
      plan.views[0]!,
      { rows: [...projection.rows, { MW: 30 }], complete: true },
      backend,
    )
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('View bounds must be enforced, not silently exceeded.')
  return { success: true }
}
