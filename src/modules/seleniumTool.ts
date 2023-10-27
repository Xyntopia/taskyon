import axios from 'axios';

type SeleniumStatus = {
  value: {
    ready: boolean;
    nodes: Array<{
      slots: Array<{
        session?: {
          sessionId: string;
        };
      }>;
    }>;
  };
};

async function checkStatus(): Promise<string | null> {
  const response = await axios.get<SeleniumStatus>(`${seleniumHubUrl}/status`, {
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
    },
  });

  const { nodes } = response.data.value;
  if (nodes.length > 0) {
    for (const node of nodes) {
      for (const slot of node.slots) {
        if (slot.session) {
          return slot.session.sessionId; // return existing sessionId
        }
      }
    }
  }

  return null; // no existing session found
}

//const seleniumHubUrl = 'http://localhost:4444/wd/hub';
const seleniumHubUrl = 'http://localhost:4444';

async function createSession() {
  const existingSessionId = await checkStatus();
  if (existingSessionId) {
    return existingSessionId; // use existing sessionId
  }

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

export async function closeSession(sessionId: string) {
  await axios.delete(`${seleniumHubUrl}/session/${sessionId}`, {
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
    },
  });
}

async function loadURL(url: string, sessionId: string) {
  await axios.post(
    `${seleniumHubUrl}/session/${sessionId}/url`,
    //'/status',
    //`${seleniumHubUrl}/session/${sessionId}/url`,
    { url: url }
    /*{
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Accept: 'application/json',
      },
    }*/
  );
}

async function fetchPageContent(sessionId: string) {
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
  function: (async ({ url }: { url: string }) => {
    console.log(`Browsing to ${url}...`);

    const sessionId = await createSession();
    console.log('got session with id:', sessionId);

    try {
      await loadURL(url, sessionId);
      const pageContent = await fetchPageContent(sessionId);
      return {
        format: 'html',
        content: pageContent,
      };
    } catch (error) {
      throw error;
    } /*finally {
      // we do not want to close sessions for increased speed :)
      await closeSession(sessionId);
    }*/
  }) as ((arg: Record<string, unknown>) => Promise<unknown>),
  description: `
      Uses Selenium WebDriver REST API to browse to a specified webpage and fetch the document content.
      Supports various document formats including HTML, PDF, TXT, JSON, etc.
      The format and content of the document are returned from the function.

      We can launch a selenium Tool in the background like this:

      docker run -p 4444:4444 -p 7900:7900 --shm-size="2g" -e SE_OPTS="--allow-cors true" selenium/standalone-chrome:latest
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