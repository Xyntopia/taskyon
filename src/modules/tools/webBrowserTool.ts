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

function cleanWebpage(htmlString: string): string {
  // Parse the HTML string into a DOM object
  const parser: DOMParser = new DOMParser();
  const doc: Document = parser.parseFromString(htmlString, 'text/html');

  // Define the tags to keep
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

  // Function to recursively remove elements not matching the tags to keep
  function cleanElement(element: Element): void {
    // Get all child elements
    const children: HTMLCollection = element.children;

    // Convert HTMLCollection to array for convenience
    const childrenArray: Element[] = Array.from(children);

    childrenArray.forEach((child: Element) => {
      // If the child's tag is not in the list, remove it
      if (!tagsToKeep.includes(child.tagName.toLowerCase())) {
        child.remove();
      } else {
        // Otherwise, recursively clean this child element
        cleanElement(child);
      }
    });
  }

  // Start cleaning from the body element
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
        browser: false,
        return_page_source: true, // don't use javascript if set to "true"
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
    const processedContent = cleanWebpage(content);
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
