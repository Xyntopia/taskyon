export interface PmtilesUrlCandidateOptions {
  suffixes?: string[]
}

export const buildPmtilesUrlCandidates = (
  url: string,
  options: PmtilesUrlCandidateOptions = {},
): string[] => {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return []

  const candidates = new Set<string>([trimmed])
  if (!trimmed.endsWith('.pmtiles')) {
    candidates.add(`${trimmed}.pmtiles`)
    ;(options.suffixes ?? []).forEach((suffix) => {
      const normalized = suffix.trim().replace(/^\/+/, '')
      if (normalized) candidates.add(`${trimmed}/${normalized}`)
    })
  }

  return [...candidates]
}
