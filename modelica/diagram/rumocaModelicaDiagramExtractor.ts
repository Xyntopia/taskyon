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
  return {
    className: asString(record.className) || 'Model',
    components: components as ModelicaDiagramDto['components'],
    connections: connections as ModelicaDiagramDto['connections'],
  }
}

export const createRumocaModelicaDiagramExtractor = (
  getWorker: () => ModelicaWorkerClient | null,
): ModelicaDiagramExtractor => ({
  extract: async (request: DiagramExtractRequest): Promise<ModelicaDiagramDto> => {
    const worker = getWorker()
    if (!worker) throw new Error('Modelica worker not loaded')
    const payloadRequest: { source: string; qualifiedName?: string; fileName?: string } = {
      source: request.source,
    }
    if (typeof request.qualifiedName === 'string' && request.qualifiedName.trim().length > 0) {
      payloadRequest.qualifiedName = request.qualifiedName
    }
    if (typeof request.fileName === 'string' && request.fileName.trim().length > 0) {
      payloadRequest.fileName = request.fileName
    }
    const payload = await worker.extractDiagram(payloadRequest)
    return ensureDiagramShape(payload)
  },
})
