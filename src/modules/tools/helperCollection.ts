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

const jinaSearch = {
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
    required: ['query', 'apiKey'],
    properties: {
      query: {
        type: 'string',
        description: 'The search query to use with the Jina AI search API.',
      },
      apiKey: {
        type: 'string',
        description: 'The API key for authenticating with the Jina AI search API.',
      },
    },
  },
  code: `({query, apiKey}) => {
    return new Promise((resolve, reject) => {
      const https = require("https");
      const data = JSON.stringify({ q: query, gl: "US", hl: "en", num: "10", page: "1" });
      const options = {
        hostname: "s.jina.ai",
        path: "/",
        method: "POST",
        headers: {
          Authorization: \`Bearer \${apiKey}\`,
          "Content-Type": "application/json",
          "X-Respond-With": "no-content",
          "X-Retain-Images": "none",
          "Content-Length": data.length,
        },
      };
      const req = https.request(options, (res) => {
        let responseData = "";
        res.on("data", (chunk) => {
          responseData += chunk;
        });
        res.on("end", () => {
          resolve(JSON.parse(responseData));
        });
      });
      req.on("error", (e) => {
        reject(e);
      });
      req.write(data);
      req.end();
    });
  }`,
} as ToolBase

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
  code: `({timestamp}) => {
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
