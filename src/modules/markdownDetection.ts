// src/modules/markdownDetection.ts
import MarkdownIt from 'markdown-it'

// A lean markdown-it instance only for HTML detection
export const mdHtmlDetector = new MarkdownIt({
  html: true, // we want HTML tokens
  linkify: false,
  typographer: false,
  highlight: () => '',
})

// --- Helper: mask out HTML containers (including their inner content) ---

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const maskHtmlContainers = (src: string): string => {
  type Range = { start: number; end: number }
  const ranges: Range[] = []
  const stack: { tag: string; start: number }[] = []

  // Matches:
  // - HTML comments: <!-- ... -->
  // - Tags: <tag ...> or </tag ...>
  const tagRe = /<!--[\s\S]*?-->|<\/?([A-Za-z][A-Za-z0-9-]*)(\s[^>]*?)?>/g

  let m: RegExpExecArray | null
  while ((m = tagRe.exec(src)) !== null) {
    const full = m[0]
    const idx = m.index
    const end = idx + full.length

    // Comments: treat as small HTML regions (we'll just mask them)
    if (full.startsWith('<!--')) {
      ranges.push({ start: idx, end })
      continue
    }

    const tagName = m[1]
    if (!tagName) continue

    const lower = tagName.toLowerCase()
    const isClosing = full[1] === '/'
    const isSelfClosing = /\/>$/.test(full) || VOID_ELEMENTS.has(lower)

    if (isClosing) {
      // Find the last unmatched opening tag with same name
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag === lower) {
          const open = stack[i]!
          stack.splice(i, 1)
          // Container range: from opening "<tag...>" to closing "</tag>"
          ranges.push({ start: open.start, end })
          break
        }
      }
    } else if (!isSelfClosing) {
      // Opening tag of a container
      stack.push({ tag: lower, start: idx })
    } else {
      // Self-closing tag: just mask the tag itself
      ranges.push({ start: idx, end })
    }
  }

  if (ranges.length === 0) return src

  // Merge overlapping ranges
  ranges.sort((a, b) => a.start - b.start)
  const merged: Range[] = []
  let cur = ranges[0]!
  for (let i = 1; i < ranges.length; i++) {
    const r = ranges[i]!
    if (r.start <= cur.end) {
      cur.end = Math.max(cur.end, r.end)
    } else {
      merged.push(cur)
      cur = r
    }
  }
  merged.push(cur)

  // Build masked string: replace chars in HTML regions with spaces,
  // but keep newlines so line-based regexes still work.
  const chars = src.split('')
  for (const r of merged) {
    for (let i = r.start; i < r.end && i < chars.length; i++) {
      const ch = chars[i]
      if (ch !== '\n' && ch !== '\r') {
        chars[i] = ' '
      }
    }
  }

  return chars.join('')
}

// --- Markdown detection, using your original patterns on the masked string ---

export const hasMarkdownElements = (raw: string): boolean => {
  const masked = maskHtmlContainers(raw)

  const markdownPatterns = [
    /(^|\n)\s*#{1,6}\s/, // headings: #, ##, ...
    /(^|\n)\s*>\s/, // blockquotes: >
    /(^|\n)\s*[-+*]\s/, // unordered lists
    /(^|\n)\s*\d+\.\s/, // ordered lists
    /\*\*(.*?)\*\*/, // bold: **bold**
    /_(.*?)_/, // italic: _italic_
    /`{1,3}[^`]+`{1,3}/, // inline or fenced code: `code`, ```block```
    /(?<!\\)\$\$[^$]+\$\$/, // mathjax block: $$...$$ (multi-line OK)
    /(?<!\\)\$[^$\n]+\$/, // mathjax inline: $...$
    /!\[.*?\]\(.*?\)/, // image
    /\[.*?\]\(.*?\)/, // link
    /(^|\n)\s*---+/, // horizontal rule
    /(^|\n)\s*:::/, // custom containers (like :::note)
  ]

  if (markdownPatterns.some((pattern) => pattern.test(masked))) {
    return true
  }

  // Treat safe HTML line breaks (<br>) as markdown when there is no
  // other HTML present. This allows inputs like "Some text with <br>"
  // (or tables containing <br>) to be recognized as markdown, while
  // still considering larger HTML fragments as HTML content.
  if (!containsHtmlTags(raw) && /<br\s*\/?>(?:\s*<br\s*\/?>)*/i.test(raw)) {
    return true
  }

  return false
}

export const containsHtmlTags = (markdown: string) => {
  const tokens = mdHtmlDetector.parse(markdown, {})

  // Recursively search for real HTML tokens (block or inline)
  const hasHtml = (toks: typeof tokens): boolean => {
    for (const t of toks) {
      if (t.type === 'html_block' || t.type === 'html_inline') {
        const trimmed = t.content.trim()
        if (!trimmed) continue

        // Ignore *pure* HTML comments
        if (/^<!--[\s\S]*?-->$/.test(trimmed)) continue

        // Ignore commonly used, safe inline tags that don't allow any content
        // or attributes, such as one or more <br> tags used for line breaks.
        // Examples that will be ignored:
        //   "<br>", "<br/>", "<br />", "<br> <br>" etc.
        if (/^(?:<br\s*\/?>(?:\s*)?)+$/i.test(trimmed)) continue

        // Anything else counts as real HTML
        return true
      }

      // Inline tokens (including html_inline) live in .children
      if (t.children && t.children.length > 0 && hasHtml(t.children)) {
        return true
      }
    }
    return false
  }

  return hasHtml(tokens)
}
