import DOMPurify from 'dompurify'

const sanitizeSvgMarkup = (markup: string) =>
  DOMPurify.sanitize(markup, {
    USE_PROFILES: {
      svg: true,
      svgFilters: true,
    },
    FORBID_TAGS: ['foreignObject', 'script'],
  })

export { sanitizeSvgMarkup }
