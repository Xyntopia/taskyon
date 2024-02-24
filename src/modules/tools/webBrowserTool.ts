import axios from 'axios';
import type { Tool } from '../taskyon/tools';
import { useTaskyonStore } from 'src/stores/taskyonState';
import { getApiByName } from '../taskyon/chat';
import { getIdToken } from '../auth/supabase';
import { Readability } from '@mozilla/readability';

const taskyonEndpoint = 'http://localhost:54321/functions/v1/api/webbrowser';

function extract_text(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const article = new Readability(doc).parse();
  return article;
}

function cleanWebpageEnhanced(htmlString: string): string {
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

function deepCleanWebpage(htmlString: string): string {
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

// Example usage with your HTML string
// const cleanedHtml: string = cleanWebpage(yourHtmlString);
// console.log(cleanedHtml);

// Example usage with your HTML string
// const cleanedHtml = cleanWebpage(yourHtmlString);
// console.log(cleanedHtml);

async function fetchContentFromURL(url: string): Promise<string> {
  const apiEndpoint = taskyonEndpoint || 'not available'; // Replace with your actual API endpoint
  try {
    const response = await axios.post<string>(
      apiEndpoint,
      {
        url: url,
        browser: true,
        return_page_source: false, // don't use javascript if set to "true"
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await getIdToken()) || ''}`, // Replace with your actual access token
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error fetching content from URL:', error);
    throw new Error('Failed to fetch content from URL');
  }
}



export const webBrowser: Tool = {
  state: () => 'available',
  function: async ({ url }: { url: string }) => {
    console.log(`Fetching content for ${url}...`);
    const content = await fetchContentFromURL(url);
    let processedContent = cleanWebpageEnhanced(content);
    processedContent = deepCleanWebpage(processedContent);
    //const processedContent = content;
    return processedContent;
  },
  description:
    "Fetches web content by sending the URL to a custom server API, which returns the webpage's content as a string. Requires an Access Token for authentication.",
  longDescription:
    "This tool communicates with a custom server API, sending a URL as an argument and receiving the webpage's content in response. The request includes an Access Token in the Authorization header for authentication. Useful for retrieving web content without directly scraping the web.",
  name: 'webBrowser',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL of the webpage to fetch content from.',
      },
    },
    required: ['url'],
  },
};
