const FENCE_MARKER_REGEX = /^\s*(`{3,}|~{3,})/

type ActiveFence = {
  markerChar: string
  markerLength: number
}

const transformOutsideInlineCode = (
  line: string,
  transformText: (value: string) => string,
): string => {
  let output = ''
  let cursor = 0

  while (cursor < line.length) {
    const tickStart = line.indexOf('`', cursor)
    if (tickStart === -1) {
      output += transformText(line.slice(cursor))
      return output
    }

    output += transformText(line.slice(cursor, tickStart))

    let tickLength = 1
    while (line[tickStart + tickLength] === '`') tickLength += 1
    const marker = '`'.repeat(tickLength)
    const closingIndex = line.indexOf(marker, tickStart + tickLength)

    if (closingIndex === -1) {
      output += line.slice(tickStart)
      return output
    }

    output += line.slice(tickStart, closingIndex + tickLength)
    cursor = closingIndex + tickLength
  }

  return output
}

const nextFenceState = (activeFence: ActiveFence | null, line: string): ActiveFence | null => {
  const fenceMatch = line.match(FENCE_MARKER_REGEX)
  const marker = fenceMatch?.[1]
  if (!marker) return activeFence

  const markerChar = marker[0] ?? ''
  if (!activeFence) {
    return {
      markerChar,
      markerLength: marker.length,
    }
  }

  if (markerChar === activeFence.markerChar && marker.length >= activeFence.markerLength) {
    return null
  }

  return activeFence
}

export const transformMarkdownTextOutsideCode = (
  input: string,
  transformText: (value: string) => string,
): string => {
  const lines = input.split('\n')
  const outputLines: string[] = []
  let activeFence: ActiveFence | null = null

  for (const line of lines) {
    const nextActiveFence = nextFenceState(activeFence, line)
    if (nextActiveFence !== activeFence) {
      activeFence = nextActiveFence
      outputLines.push(line)
      continue
    }

    if (activeFence) {
      outputLines.push(line)
      continue
    }

    outputLines.push(transformOutsideInlineCode(line, transformText))
  }

  return outputLines.join('\n')
}

export const stripHtmlCommentsOutsideMarkdownCode = (input: string): string =>
  transformMarkdownTextOutsideCode(input, (text) => text.replace(/<!--[\s\S]*?-->/g, ''))
