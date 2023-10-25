import axios from 'axios';

const seleniumHubUrl = 'http://localhost:4444/wd/hub';

async function createSession() {
  const response = await axios.post<{
    value: {
      sessionId: string;
    };
  }>(
    `${seleniumHubUrl}/session`,
    {
      capabilities: {
        firstMatch: [{}],
        alwaysMatch: {
          browserName: 'chrome',
          pageLoadStrategy: 'normal',
          'goog:chromeOptions': {
            extensions: [],
            args: [],
          },
        },
      },
    },
    {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Accept: 'application/json',
      },
    }
  );
  return response.data.value.sessionId;
}

async function closeSession(sessionId: string) {
  await axios.delete(`${seleniumHubUrl}/session/${sessionId}`, {
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
    },
  });
}

async function fetchPageContent(url: string, sessionId: string) {
  await axios.post(
    `${seleniumHubUrl}/session/${sessionId}/url`,
    { url },
    {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Accept: 'application/json',
      },
    }
  );

  const pageSourceResponse = await axios.get<{ value: string }>(
    `${seleniumHubUrl}/session/${sessionId}/source`,
    {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Accept: 'application/json',
      },
    }
  );
  return pageSourceResponse.data.value;
}

type toolStatusType = 'available' | 'starting' | 'unavailable' | 'error';

export const seleniumBrowser = {
  status: () => {
    return 'available' as toolStatusType;
  },
  function: async ({ url }: { url: string }) => {
    console.log(`Browsing to ${url}...`);

    const sessionId = await createSession();
    console.log('got session with id:', sessionId);

    try {
      const pageContent = await fetchPageContent(url, sessionId);
      return {
        format: 'html',
        content: pageContent,
      };
    } finally {
      await closeSession(sessionId);
    }
  },
  description: `
      Uses Selenium WebDriver REST API to browse to a specified webpage and fetch the document content.
      Supports various document formats including HTML, PDF, TXT, JSON, etc.
      The format and content of the document are returned from the function.
    `,
  name: 'seleniumBrowser',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL of the webpage to browse.',
      },
    },
    required: ['url'],
  },
};
