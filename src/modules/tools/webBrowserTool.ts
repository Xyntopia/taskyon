import axios from 'axios';
import type { Tool } from '../taskyon/tools';

type ApiResponse = {
  content: string; // Assuming the API returns an object with a content property
};

async function fetchContentFromURL(url: string): Promise<string> {
  const apiEndpoint = 'yourServerApiEndpoint'; // Replace with your actual API endpoint
  try {
    const response = await axios.post<ApiResponse>(
      apiEndpoint,
      { url: url },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer YourAccessTokenHere', // Replace with your actual access token
        },
      }
    );
    return response.data.content;
  } catch (error) {
    console.error('Error fetching content from URL:', error);
    throw new Error('Failed to fetch content from URL');
  }
}

export const customWebContentFetcher: Tool = {
  state: () => 'available' as 'available' | 'starting' | 'unavailable' | 'error',
  function: async ({ url }: { url: string }) => {
    console.log(`Fetching content for ${url}...`);
    const content = await fetchContentFromURL(url);
    return {
      format: 'text', // Assuming the API returns plain text. Adjust if the format is different.
      content: content,
    };
  },
  description: `Fetches web content by sending the URL to a custom server API, which returns the webpage's content as a string. Requires an Access Token for authentication.`,
  longDescription: `This tool communicates with a custom server API, sending a URL as an argument and receiving the webpage's content in response. The request includes an Access Token in the Authorization header for authentication. Useful for retrieving web content without directly scraping the web.`,
  name: 'customWebContentFetcher',
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
