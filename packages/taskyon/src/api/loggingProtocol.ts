import {
  createPortClient,
  createPortServer,
  defineFrpServiceProtocol,
  type Port,
  type ProtocolMessage,
} from '@taskyon/common/modules/frpBus'
import { z } from 'zod'

const taskyonLogEntry = z.object({
  timestamp: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  source: z.string().min(1),
  message: z.string(),
  streamId: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
})

export type TaskyonLogEntry = z.output<typeof taskyonLogEntry>

export const taskyonLoggingProtocol = defineFrpServiceProtocol({
  service: 'logging',
  version: '1',
  commands: {
    write: { request: taskyonLogEntry },
    flush: { request: z.object({}) },
  },
})

export type TaskyonLoggingMessage = ProtocolMessage<typeof taskyonLoggingProtocol>

export type TaskyonLogSink = {
  write: (entry: TaskyonLogEntry) => Promise<void> | void
  flush: () => Promise<void> | void
}

export const createLoggingClient = (port: Port<TaskyonLoggingMessage, TaskyonLoggingMessage>) =>
  createPortClient(port, taskyonLoggingProtocol).logging

export const createLoggingProtocolServer = (
  port: Port<TaskyonLoggingMessage, TaskyonLoggingMessage>,
  sink: TaskyonLogSink,
) =>
  createPortServer(port, taskyonLoggingProtocol, {
    logging: {
      write: async (entry) => {
        await sink.write(entry)
      },
      flush: async () => {
        await sink.flush()
      },
    },
  })
