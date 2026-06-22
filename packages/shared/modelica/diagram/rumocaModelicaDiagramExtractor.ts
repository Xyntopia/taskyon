import type { ModelicaWorkerClient } from '../modelicaWorkerClient'
import type { DiagramExtractRequest, ModelicaDiagramDto, ModelicaDiagramExtractor } from './types'

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const ensureDiagramShape = (value: unknown): ModelicaDiagramDto => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid diagram payload: expected object')
  }
  const record = value as Record<string, unknown>
  const components = Array.isArray(record.components) ? record.components : []
  const connections = Array.isArray(record.connections) ? record.connections : []
  const classIcon =
    record.classIcon && typeof record.classIcon === 'object'
      ? (record.classIcon as ModelicaDiagramDto['classIcon'])
      : null
  return {
    className: asString(record.className) || 'Model',
    ...(classIcon ? { classIcon } : {}),
    components: components as ModelicaDiagramDto['components'],
    connections: connections as ModelicaDiagramDto['connections'],
  }
}

const toWorkerPayload = (
  request: DiagramExtractRequest,
): { source: string; qualifiedName?: string; fileName?: string } => {
  const payloadRequest: { source: string; qualifiedName?: string; fileName?: string } = {
    source: request.source,
  }
  if (typeof request.qualifiedName === 'string' && request.qualifiedName.trim().length > 0) {
    payloadRequest.qualifiedName = request.qualifiedName
  }
  if (typeof request.fileName === 'string' && request.fileName.trim().length > 0) {
    payloadRequest.fileName = request.fileName
  }
  return payloadRequest
}

export const createRumocaModelicaDiagramExtractor = (
  getWorker: () => ModelicaWorkerClient | null,
): ModelicaDiagramExtractor => ({
  extract: async (request: DiagramExtractRequest): Promise<ModelicaDiagramDto> => {
    const worker = getWorker()
    if (!worker) throw new Error('Modelica worker not loaded')
    const payload = await worker.extractDiagram(toWorkerPayload(request))
    return ensureDiagramShape(payload)
  },
  extractPreview: async (request: DiagramExtractRequest): Promise<ModelicaDiagramDto> => {
    const worker = getWorker()
    if (!worker) throw new Error('Modelica worker not loaded')
    const payload = await worker.extractDiagramPreview(toWorkerPayload(request))
    return ensureDiagramShape(payload)
  },
  materialize: async (request: DiagramExtractRequest): Promise<void> => {
    const worker = getWorker()
    if (!worker) throw new Error('Modelica worker not loaded')
    await worker.materializeDiagramClasses(toWorkerPayload(request))
  },
})
