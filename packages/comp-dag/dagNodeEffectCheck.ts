import type { DagNodeEffect } from './dagCore.ts'

export type DagNodeEffectIssue = {
  severity: 'block' | 'warn'
  capability: string
  message: string
}

const ambientCapabilities = [
  { capability: 'fetch', pattern: /(?<![.\w])fetch\s*\(/ },
  { capability: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { capability: 'filesystem', pattern: /(?<![.\w])(readFile|openFile)\s*\(/ },
  { capability: 'browser storage', pattern: /\b(localStorage|sessionStorage|indexedDB)\b/ },
] as const

const uncertainCapabilities = [
  { capability: 'clock', pattern: /\b(Date\.now|new\s+Date)\b/ },
  { capability: 'randomness', pattern: /\b(Math\.random|crypto\.randomUUID)\b/ },
  { capability: 'browser global', pattern: /\b(window|document|navigator)\b/ },
] as const

export const analyzeDagNodeEffectSource = (
  effect: DagNodeEffect,
  runSource: string,
): DagNodeEffectIssue[] => {
  if (effect === 'source') return []
  const blocks = ambientCapabilities
    .filter(({ pattern }) => pattern.test(runSource))
    .map(({ capability }) => ({
      severity: 'block' as const,
      capability,
      message: `Pure node directly accesses ambient ${capability}. Declare it as source or inject the value through an input.`,
    }))
  const warnings = uncertainCapabilities
    .filter(({ pattern }) => pattern.test(runSource))
    .map(({ capability }) => ({
      severity: 'warn' as const,
      capability,
      message: `Pure node may depend on ambient ${capability}; verify that execution stays reproducible.`,
    }))
  return [...blocks, ...warnings]
}

export const assertDagNodeEffectSource = (effect: DagNodeEffect, runSource: string): void => {
  const blocked = analyzeDagNodeEffectSource(effect, runSource).filter(
    ({ severity }) => severity === 'block',
  )
  if (blocked.length === 0) return
  throw new Error(blocked.map(({ message }) => message).join(' '))
}
