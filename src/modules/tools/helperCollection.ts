import { createTool } from '../taskyon/tools'
import type { ToolBase } from '../taskyon/types'

const jinaMarkdownReader = {
  description: 'A tool that reads websites as markdown using the jina ai reader.',
  longDescription:
    'This tool uses the jina ai reader to fetch webpages via https://r.jina.ai/ and converts them to markdown format.',
  name: 'jinaMarkdownReader',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: 'The URL of the website to read as markdown.',
      },
    },
  },
  code: `({url}) => {
    return fetch(\`https://r.jina.ai/\${url}\`)
      .then(response => response.text())
      .then(data => data);
  }`,
} as ToolBase

// TODO: add more functionality from here:   https://r.jina.ai/docs
// TODO: add a state how many tokesn we have left over :)
const jinaSearch = createTool({
  description: 'A tool that searches using the Jina AI search API.',
  longDescription:
    'This tool uses the Jina AI search API to perform searches and retrieve results.',
  name: 'jinaSearch',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'The search query to use with the Jina AI search API.',
      },
    },
  },
  function: async ({ query }: { query: string }, ctx) => {
    // get key from here:  https://jina.ai/api-dashboard/key-manager
    const apiKey = await ctx.getSecret(
      'Search API key',
      'Please enter the key for jina search api. You can create new keys here:  https://jina.ai/api-dashboard/key-manager',
      true, // save new secret
    )
    if (!apiKey) {
      throw new Error(
        'Provided API key for Jina web search is empty! (Please check [secretStore](/settings/secrets) to edit the key.)',
      )
    }
    try {
      // TODO: add a preferred country and location and language with
      //       &gl=US&location=san+diego&hl=en
      //
      // TODO:   enable searching in only specific sites:
      //         "X-Site: https://jina.ai"
      const response = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Respond-With': 'no-content',
          Accept: 'application/json',
          'X-With-Favicons': 'true',
        },
      })
      const body = await response.json()
      if (response.status === 401)
        throw new Error(
          'maybe the API key is wrong? Please check [secretStore](/settings/secrets)\n\n' +
            body.toString(),
        )
      if (response.status != 200) throw new Error(body.toString())
      console.log('Raw response:', body)

      // data =
      const search = (body.data as Record<string, string>[]).reduce(
        (p, c: Record<string, string>, idx) => {
          p[idx] = {
            title: c.title,
            description: c.description,
            url: c.url,
          }
          return p
        },
        {} as Record<string, Record<string, unknown>>,
      )

      //return dump(search, { skipInvalid: true })
      return search
    } catch (error) {
      console.error('Error searching with Jina AI:', error)
      throw error
    }
  },
})

const clock = {
  description: 'A tool that provides the current time, date, and weekday.',
  longDescription:
    'This tool returns the current time, date, and weekday when no arguments are provided. If a Unix timestamp is provided as an argument, it returns the corresponding time, date, and weekday.',
  name: 'clock',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    properties: {
      timestamp: {
        type: 'number',
        description:
          'A Unix timestamp to convert to time, date, and weekday. If not provided, the current time will be used.',
      },
    },
  },
  code: `({timestamp}, ctx) => {
    const date = timestamp ? new Date(timestamp * 1000) : new Date();
    return {
      time: date.toLocaleTimeString(),
      date: date.toLocaleDateString(),
      weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
      seconds: date.getSeconds(),
    };
  }`,
} as ToolBase

const location = {
  description: 'A tool that provides the current browser location and IP address.',
  longDescription:
    'This tool retrieves the current browser location using the Geolocation API and the IP address using an external service. It also estimates the location based on the IP address.',
  name: 'location',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    properties: {},
  },
  code: `() => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject('Geolocation is not supported by your browser');
      } else {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            fetch('https://api.ipify.org?format=json')
              .then(response => response.json())
              .then(data => {
                const ip = data.ip;
                fetch(\`https://ipapi.co/\${ip}/json/\`)
                  .then(response => response.json())
                  .then(locationData => {
                    resolve({
                      latitude,
                      longitude,
                      ip,
                      estimatedLocation: {
                        city: locationData.city,
                        region: locationData.region,
                        country: locationData.country_name,
                      },
                    });
                  })
                  .catch(error => reject(error));
              })
              .catch(error => reject(error));
          },
          (error) => reject(error)
        );
      }
    });
  }`,
} as ToolBase

const notification = {
  description: 'Displays a browser-native notification with an optional delay.',
  longDescription:
    'This tool allows users to display a browser-native notification with a custom message. Optionally, users can specify a specific time or number of seconds to wait before displaying the notification.',
  name: 'delayedNotification',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    required: ['message'],
    properties: {
      message: {
        type: 'string',
        description: 'The message to be displayed in the notification.',
      },
      delay: {
        type: 'number',
        description:
          'The time in milliseconds to wait before displaying the notification. If not provided, the notification will be displayed immediately.',
      },
    },
  },
  code: `({ message, delay = 0 }) => {
    if (Notification.permission === 'granted') {
      setTimeout(() => {
        new Notification(message)
      }, delay)
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          setTimeout(() => {
            new Notification(message)
          }, delay)
        }
      })
    }
  }`,
} as ToolBase

export const smallHelperTools = [jinaMarkdownReader, jinaSearch, clock, location, notification]
