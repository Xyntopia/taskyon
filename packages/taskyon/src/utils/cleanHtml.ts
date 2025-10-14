//import { Readability } from '@mozilla/readability';

// cleaner.ts

export interface CleanOptions {
  keepTags?: string[] | null
  removeScriptsStyles?: boolean
  removeComments?: boolean
  dropEmptyElements?: boolean
  stripAllAttributes?: boolean
  allowedAttributes?: Record<string, string[]> | null // 👈 allow null
  pruneNonMeaningful?: boolean
  meaningfulTextRegex?: RegExp
  useReadability?: boolean
}

export const CLEAN_PRESETS = {
  enhanced: {
    keepTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'div', 'section'],
    removeScriptsStyles: true,
    removeComments: true,
    dropEmptyElements: true,
    stripAllAttributes: false,
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt'] },
    pruneNonMeaningful: false,
    meaningfulTextRegex: /\S/,
    useReadability: false,
  } satisfies CleanOptions,

  deep: {
    keepTags: null,
    removeScriptsStyles: true,
    removeComments: true,
    dropEmptyElements: true,
    stripAllAttributes: true,
    allowedAttributes: {},
    pruneNonMeaningful: true,
    meaningfulTextRegex: /\S/,
    useReadability: false,
  } satisfies CleanOptions,
} as const

/**
 * Cleans an HTML string according to the given options.
 * - Removes scripts/styles/comments
 * - Drops unwanted/empty elements
 * - Optionally prunes nodes without meaningful text
 * - Strips or whitelists attributes
 * - Can heuristically focus on main content
 */
export function cleanWebpage(htmlString: string, options: CleanOptions = {}): string {
  const opts: Required<CleanOptions> = {
    keepTags: options.keepTags ?? null,
    removeScriptsStyles: options.removeScriptsStyles ?? true,
    removeComments: options.removeComments ?? true,
    dropEmptyElements: options.dropEmptyElements ?? true,
    stripAllAttributes: options.stripAllAttributes ?? false,
    allowedAttributes: options.allowedAttributes ?? { a: ['href', 'title'], img: ['src', 'alt'] },
    pruneNonMeaningful: options.pruneNonMeaningful ?? false,
    meaningfulTextRegex: options.meaningfulTextRegex ?? /\S/,
    useReadability: options.useReadability ?? false,
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlString, 'text/html')

  // --- readability-like main content detection ---
  let root: Element = doc.body
  if (opts.useReadability) {
    root = doc.querySelector('main, article') ?? root
    if (root === doc.body) {
      // fallback: find div/section with max text length
      let maxLen = 0
      for (const cand of doc.querySelectorAll('div,section')) {
        const len = (cand.textContent ?? '').length
        if (len > maxLen) {
          root = cand
          maxLen = len
        }
      }
    }
  }

  const hasMeaningfulContent = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      return opts.meaningfulTextRegex.test(node.nodeValue || '')
    }
    return Array.from(node.childNodes).some(hasMeaningfulContent)
  }

  const stripAttributes = (el: Element) => {
    if (opts.stripAllAttributes) {
      while (el.attributes.length) el.removeAttribute(el.attributes[0]!.name)
      return
    }
    const allowed = opts.allowedAttributes?.[el.tagName.toLowerCase()] ?? []
    for (const attr of Array.from(el.attributes)) {
      if (!allowed.includes(attr.name.toLowerCase())) el.removeAttribute(attr.name)
    }
  }

  const shouldDropElementNow = (el: Element): boolean =>
    opts.keepTags !== null && !opts.keepTags.includes(el.tagName.toLowerCase())

  const walk = (node: Node): void => {
    if (opts.removeComments && node.nodeType === Node.COMMENT_NODE) {
      node.parentNode?.removeChild(node)
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element

    if (opts.removeScriptsStyles && (el.tagName === 'SCRIPT' || el.tagName === 'STYLE')) {
      el.parentNode?.removeChild(el)
      return
    }

    if (shouldDropElementNow(el)) {
      el.parentNode?.removeChild(el)
      return
    }

    stripAttributes(el)

    for (const child of Array.from(el.childNodes)) walk(child)

    if (opts.pruneNonMeaningful && !hasMeaningfulContent(el)) {
      el.parentNode?.removeChild(el)
      return
    }

    if (opts.dropEmptyElements) {
      const hasElementChild = el.children.length > 0
      const hasText = opts.meaningfulTextRegex.test(el.textContent || '')
      if (!hasElementChild && !hasText) el.parentNode?.removeChild(el)
    }
  }

  walk(root)
  return root.innerHTML
}

/** Shortcut: cleans webpage using the "enhanced" preset
 * (keeps common text tags, allows some attributes). */
export function cleanWebpageEnhanced(htmlString: string): string {
  return cleanWebpage(htmlString, CLEAN_PRESETS.enhanced)
}

/** Shortcut: aggressively cleans webpage using the
 * "deep" preset (drops almost all tags/attributes). */
export function deepCleanWebpage(htmlString: string): string {
  return cleanWebpage(htmlString, CLEAN_PRESETS.deep)
}
