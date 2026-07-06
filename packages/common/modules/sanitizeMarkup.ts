import DOMPurify from 'dompurify'

export const sanitizeSvgMarkup = (markup: string): string =>
  DOMPurify.sanitize(markup, {
    USE_PROFILES: {
      svg: true,
      svgFilters: true,
    },
    FORBID_TAGS: ['foreignObject', 'script'],
  })

export const sanitizeHtmlMarkup = (markup: string): string =>
  DOMPurify.sanitize(markup, {
    USE_PROFILES: { html: true },
  })

export const renderSanitizedMarkup = (host: HTMLElement, markup: string): void => {
  const parsed = new DOMParser().parseFromString(`<div>${markup}</div>`, 'text/html')
  const wrapper = parsed.body.firstElementChild
  const fragment = document.createDocumentFragment()
  for (const child of Array.from(wrapper?.childNodes ?? [])) {
    fragment.appendChild(document.importNode(child, true))
  }
  host.replaceChildren(fragment)
}
