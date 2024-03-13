import { Readability } from '@mozilla/readability';

function extractText(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const article = new Readability(doc).parse();
  return article;
}
export function cleanWebpageEnhanced(htmlString: string): string {
  // Parse the HTML string into a DOM object
  const parser: DOMParser = new DOMParser();
  const doc: Document = parser.parseFromString(htmlString, 'text/html');

  // Define the tags to keep based on content-rich criteria
  const tagsToKeep: string[] = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'a',
    'ul',
    'ol',
    'li',
    'div',
    'section',
  ];

  // Function to determine if an element is considered empty
  function isEmptyElement(element: Element): boolean {
    return !element.textContent?.trim() && element.children.length === 0;
  }

  // Function to recursively clean an element
  function cleanElement(element: Element): void {
    // Remove script-related elements and comments
    Array.from(element.childNodes).forEach((node) => {
      if (
        node.nodeType === Node.COMMENT_NODE ||
        (node as HTMLElement).tagName === 'SCRIPT' ||
        (node as HTMLElement).tagName === 'STYLE'
      ) {
        node.parentNode?.removeChild(node);
      }
    });

    // Get all child elements
    const children: HTMLCollection = element.children;

    // Convert HTMLCollection to array for convenience
    const childrenArray: Element[] = Array.from(children);

    childrenArray.forEach((child: Element) => {
      // Remove non-essential elements and empty divs/sections
      if (
        !tagsToKeep.includes(child.tagName.toLowerCase()) ||
        isEmptyElement(child)
      ) {
        child.remove();
      } else {
        // Recursively clean this child element
        cleanElement(child);
      }
    });
  }

  // Start cleaning from the body element
  cleanElement(doc.body);

  // Return the cleaned HTML as a string
  return doc.body.innerHTML;
}
export function deepCleanWebpage(htmlString: string): string {
  // Parse the HTML string into a DOM object
  const parser: DOMParser = new DOMParser();
  const doc: Document = parser.parseFromString(htmlString, 'text/html');

  // Function to check if an element (or its children) contains meaningful content
  function hasMeaningfulContent(element: Node): boolean {
    return element.nodeType === Node.TEXT_NODE
      ? /\S/.test(element.nodeValue || '')
      : Array.from(element.childNodes).some(hasMeaningfulContent);
  }

  // Function to strip all attributes from an element
  function stripAttributes(element: Element): void {
    while (element.attributes.length > 0) {
      element.removeAttribute(element.attributes[0].name);
    }
  }

  // Function to recursively clean an element
  function cleanElement(element: Node): void {
    if (element.nodeType === Node.ELEMENT_NODE) {
      stripAttributes(element as Element);

      // Convert NodeList to array for convenience
      const childNodesArray: Node[] = Array.from(element.childNodes);

      childNodesArray.forEach((child: Node) => {
        if (!hasMeaningfulContent(child)) {
          element.removeChild(child);
        } else {
          cleanElement(child);
        }
      });
    }
  }

  // Start the deep cleaning process from the body element
  cleanElement(doc.body);

  // Return the cleaned HTML as a string
  return doc.body.innerHTML;
}
