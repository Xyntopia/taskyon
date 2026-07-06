//runMarkdownDetectionTests.ts
import { hasMarkdownElements, containsHtmlTags } from '@taskyon/common/modules/markdownDetection'
import { stripHtmlCommentsOutsideMarkdownCode } from '@taskyon/common/modules/markdownText'

// Assuming hasMarkdownElements and containsHtmlTags are in scope
// import { hasMarkdownElements, containsHtmlTags } from './your-module'
/**
 * Run a small suite of detection tests against hasMarkdownElements
 * and containsHtmlTags, and return a summary.
 */

export function runMarkdownDetectionTests() {
  const cases = [
    {
      name: 'plain text',
      input: 'Just a normal sentence with no markdown or HTML.',
      expectMarkdown: false,
      expectHtml: false,
    },
    {
      name: 'heading',
      input: '# Heading 1',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'blockquote',
      input: '> a quote',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'unordered list',
      input: '- item 1\n- item 2',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'ordered list',
      input: '1. first\n2. second',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'bold text',
      input: 'Some **bold** text',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'italic text',
      input: 'Some _italic_ text',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'inline code',
      input: 'Use `npm install` to install.',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'fenced code (single-line content)',
      input: '```js\nconsole.log(1)\n```',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'inline math',
      input: 'Inline math $x^2 + y^2$ inside text.',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'block math single-line',
      input: '$$x^2 + y^2 = z^2$$',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'image',
      input: '![Alt text](https://example.com/image.png)',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'link',
      input: '[Example](https://example.com)',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'horizontal rule',
      input: 'Some text\n---\nMore text',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'custom container',
      input: ':::\nnote content\n:::',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'simple HTML block',
      input: '<div>HTML content</div>',
      expectMarkdown: false,
      expectHtml: true,
    },
    {
      name: 'inline HTML',
      input: 'Text with <span>inline HTML</span> inside.',
      expectMarkdown: false,
      expectHtml: true,
    },
    {
      name: 'HTML comment only (should NOT count as HTML)',
      input: '<!-- Just a comment -->',
      expectMarkdown: false,
      expectHtml: false,
    },
    {
      name: '<code> HTML only (should NOT count as HTML)',
      input: '<code>inline code in HTML tag</code>',
      expectMarkdown: false,
      expectHtml: true,
    },
    {
      name: 'HTML comment and real HTML mixed',
      input: '<!-- comment --><span>real</span>',
      expectMarkdown: false,
      expectHtml: true,
    },
    {
      name: 'Markdown + HTML mixed',
      input: '**bold** and <div>html</div>',
      expectMarkdown: true,
      expectHtml: true,
    },
    {
      name: 'newline before markdown heading',
      input: 'Intro text\n\n## Subheading',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'escape dollar in math-like text (should not match math)',
      input: 'Price is \\$5.00 only',
      expectMarkdown: false,
      expectHtml: false,
    },
    {
      name: 'complex markdown document',
      input:
        '# Title\n\nSome text with a [link](https://example.com) and `code`.\n\n- item 1\n- item 2',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'list item with inline HTML',
      input: '- item with <strong>HTML</strong> inside',
      expectMarkdown: true,
      expectHtml: true,
    },
    {
      name: 'html inside fenced code should not count as HTML',
      input: '```html\n<div>not real HTML here</div>\n```',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'fenced code with dollars and html-like text',
      input: '```\nPrice is $5 and <div>not html</div>\n```',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'html-looking text inside inline code',
      input: 'Use `<div>` to create a block.',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'self-closing html tag',
      input: 'Image: <img src="x.png" alt="x" />',
      expectMarkdown: false,
      expectHtml: true,
    },
    {
      name: 'multiline html block with attributes',
      input: '<section class="foo">\n  <p>text</p>\n</section>',
      expectMarkdown: false,
      expectHtml: true,
    },
    {
      name: 'multiple math expressions',
      input: 'First $a^2$, then $$b^2$$ and finally $c^2$.',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'escaped inline math should not be detected',
      input: 'Show literal formula: \\$x^2 + y^2$',
      expectMarkdown: false,
      expectHtml: false,
    },
    {
      name: 'horizontal rule with surrounding spaces',
      input: 'Text above\n \n   ---   \nText below',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'labeled custom container',
      input: ':::note\ncontent\n:::',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'inline html comment inside text',
      input: 'Text <!-- hidden note --> continues.',
      expectMarkdown: false,
      expectHtml: false,
    },
    {
      name: 'html comment then block html with newline',
      input: '<!-- comment -->\n<div>real</div>',
      expectMarkdown: false,
      expectHtml: true,
    },
    {
      name: 'markdown italics and inline HTML mixed',
      input: '_italic_ and <em>html</em> together',
      expectMarkdown: true,
      expectHtml: true,
    },
    {
      name: 'multiple paragraphs without markdown or html',
      input: 'First paragraph.\n\nSecond paragraph.',
      expectMarkdown: false,
      expectHtml: false,
    },
    {
      name: 'mixed markdown, html and math in list',
      input:
        '# Title\n\nIntro with [link](https://example.com) and <span>HTML</span>.\n\n1. Item with $x^2$ and **bold**\n2. Second item',
      expectMarkdown: true,
      expectHtml: true,
    },
    {
      name: 'html block wrapping markdown content',
      input: '<div class="wrapper">\n\n## Inner heading\n\n- item one\n- item two\n\n</div>',
      expectMarkdown: false, // markdown will not be rendered...
      expectHtml: true,
    },
    {
      name: 'markdown fenced code and real html after it',
      input:
        '```html\n<div>example code block only</div>\n```\n\nActual HTML below:\n<span>real</span>',
      expectMarkdown: true,
      expectHtml: true,
    },
    {
      name: 'html and markdown link side by side',
      input: '<a href="https://example.com">HTML link</a> and [Markdown link](https://example.com)',
      expectMarkdown: true,
      expectHtml: true,
    },
    {
      name: 'complex math block with newlines',
      input: '$$\nE = mc^2 \\\\\nF = ma\n$$\n\nAnd some following text.',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'html with embedded markdown-like text',
      input: '<div>\n  Here is **bold-looking** text but inside HTML.\n</div>',
      expectMarkdown: false,
      expectHtml: true,
    },
    {
      name: 'nested markdown lists with inline html and code',
      input: '- Parent item\n  - Child with <em>HTML</em>\n  - Child with `code` and $x+1$',
      expectMarkdown: true,
      expectHtml: true,
    },
    {
      name: 'html comment with fake html plus real html',
      input: '<!-- <span>hidden</span> --> Visible <span>shown</span>',
      expectMarkdown: false,
      expectHtml: true, // pure comment ignored, real span counts
    },
    {
      name: 'taskyon style html comment prefixed to plain text',
      input: '<!-- taskyon variable result1 content end -->The image displays the Taskyon logo.',
      expectMarkdown: false,
      expectHtml: false,
    },
    {
      name: 'taskyon style html comment before markdown content',
      input: '<!-- taskyon variable result1 content end -->\n\nThe image displays **Taskyon**.',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'script block html',
      input: '<script>\n  const x = 1 < 2 ? "yes" : "no";\n</script>',
      expectMarkdown: false,
      expectHtml: true,
    },
    {
      name: 'mixed containers, code and html',
      input:
        ':::note\nImportant: use `<div>` and **bold** text.\n:::\n\nAlso see <div>extra</div>.',
      expectMarkdown: true,
      expectHtml: true,
    },
    {
      name: 'multiple html blocks separated by markdown',
      input: '<header>Top</header>\n\n# Heading\n\nContent\n\n<footer>Bottom</footer>',
      expectMarkdown: true,
      expectHtml: true,
    },
    {
      name: 'multiple paragraphs, lists, math and inline html',
      input:
        'Paragraph one with <strong>HTML</strong>.\n\n' +
        'Paragraph two with _italic_ and $a^2$.\n\n' +
        '- list item with [link](https://example.com)\n- another item',
      expectMarkdown: true,
      expectHtml: true,
    },
    {
      name: 'markdown with <br> symbol',
      input: 'Some text with <br> line break.',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'markdown with multiple <br> symbols',
      input: 'Some text with <br> <br> multiple line breaks.',
      expectMarkdown: true,
      expectHtml: false,
    },
    {
      name: 'markdown with <br> in tables',
      input: '| column | description |\n| --- | --- |\n| cell 1 | line 1 <br> line 2 |',
      expectMarkdown: true,
      expectHtml: false,
    },
  ]

  const results = cases.map((tc) => {
    const actualMarkdown = hasMarkdownElements(tc.input)
    const actualHtml = containsHtmlTags(tc.input)

    return {
      ...tc,
      actualMarkdown,
      actualHtml,
      markdownOk: actualMarkdown === tc.expectMarkdown,
      htmlOk: actualHtml === tc.expectHtml,
    }
  })

  const commentCases = [
    {
      name: 'plain html comment is hidden',
      input: '<!-- hidden -->Visible text',
      expected: 'Visible text',
    },
    {
      name: 'html comment before markdown is hidden',
      input: '<!-- hidden -->\n\n**Visible**',
      expected: '\n\n**Visible**',
    },
    {
      name: 'html comment in fenced code stays visible',
      input: '```html\n<!-- visible -->\n```',
      expected: '```html\n<!-- visible -->\n```',
    },
    {
      name: 'html comment in inline code stays visible',
      input: 'Use `<!-- visible -->` literally.',
      expected: 'Use `<!-- visible -->` literally.',
    },
  ]
  const commentResults = commentCases.map((tc) => {
    const actual = stripHtmlCommentsOutsideMarkdownCode(tc.input)
    return {
      ...tc,
      actual,
      ok: actual === tc.expected,
    }
  })

  const markdownFailed = results.filter((r) => !r.markdownOk)
  const htmlFailed = results.filter((r) => !r.htmlOk)
  const commentFailed = commentResults.filter((r) => !r.ok)

  const res = {
    total: cases.length + commentCases.length,
    success: markdownFailed.length + htmlFailed.length + commentFailed.length === 0,
    markdown: {
      passed: cases.length - markdownFailed.length,
      failed: markdownFailed.length,
      failedCases: markdownFailed,
    },
    html: {
      passed: cases.length - htmlFailed.length,
      failed: htmlFailed.length,
      failedCases: htmlFailed,
    },
    comments: {
      passed: commentCases.length - commentFailed.length,
      failed: commentFailed.length,
      failedCases: commentFailed,
    },
  }

  if (!res.success) throw new Error('markdown/html detection did not work:', { cause: res })

  return res
}
