import type { JSONSchema7 } from 'json-schema'
import { createTool } from '../taskyon/tools'

const jinaMarkdownReader = createTool({
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
})

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
  } as const satisfies JSONSchema7,
  function: async ({ query }, ctx) => {
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

const clock = createTool({
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
})

const location = createTool({
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
})

const notification = createTool({
  description:
    'Displays a list of OS-level browser notifications, at a delay, at a specific date/time, or at a time today (rolling to tomorrow if already passed).',
  longDescription:
    'Schedules browser-native notifications that appear in the OS notification area (if the browser supports it and permission is granted). ' +
    'Each item can specify a delay (ms), a specific date/time (ISO or epoch), or a time-only (e.g. "1pm", "13:00"), which is interpreted in local time for today and rolls to tomorrow if already passed.',
  name: 'notification',
  renderOptions: { hideChat: false, hideLlm: false },
  parameters: {
    type: 'object',
    required: ['list'],
    properties: {
      list: {
        type: 'array',
        description: 'List of notifications to schedule.',
        items: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', description: 'Notification text.' },
            delay: {
              type: 'number',
              description: 'Delay in milliseconds before showing. Ignored if `time` is provided.',
            },
            time: {
              // keep as string for time-only like "1pm" but also allow number
              anyOf: [{ type: 'string' }, { type: 'number' }],
              description:
                'When to show: ISO string, epoch (ms or s), or time-only (e.g. "1pm", "13:00", "13:00:30"). Time-only is interpreted as LOCAL today (rolls to tomorrow if already passed).',
            },
          },
        },
      },
    },
  },
  code: `({ list }) => {
    const log = (...args) => console.log("[NotificationTool]", ...args);

    const isEpochSeconds = (n) => Number.isFinite(n) && n < 1e12;
    const timeOnlyRe = /^\\s*(\\d{1,2})(?::(\\d{2}))?(?::(\\d{2}))?\\s*(am|pm)?\\s*$/i;

    const parseWhen = (input) => {
      // returns millis epoch or null
      if (input == null) return null;

      // number: epoch ms or seconds
      if (typeof input === 'number') {
        const ms = isEpochSeconds(input) ? input * 1000 : input;
        log("Parsed numeric epoch", { input, ms });
        return ms;
      }

      if (typeof input === 'string') {
        // time-only?
        const m = input.match(timeOnlyRe);
        if (m) {
          let [_, hh, mm = "0", ss = "0", ap] = m;
          let H = parseInt(hh, 10);
          const M = parseInt(mm, 10);
          const S = parseInt(ss, 10);
          if (ap) {
            const isPM = ap.toLowerCase() === 'pm';
            if (H === 12) H = isPM ? 12 : 0; else H = isPM ? H + 12 : H;
          }
          const now = new Date();
          const target = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            H, M, S, 0
          ).getTime();
          const final = (target <= Date.now()) ? target + 24 * 60 * 60 * 1000 : target;
          log("Parsed time-only ->", { input, todayTarget: target, rolledTo: final, localNow: new Date() });
          return final;
        }

        // ISO / other date string
        const t = Date.parse(input);
        if (!Number.isNaN(t)) {
          log("Parsed date string", { input, parsed: t, as: new Date(t) });
          return t;
        }

        log("Unrecognized time format", { input });
        return null;
      }

      // fallback
      return null;
    };

    const schedule = (message, delayMs) => {
      log("Scheduling", { message, delayMs });
      setTimeout(() => {
        try {
          log("Triggering notification", { message, at: new Date() });
          new Notification(message);
        } catch (e) {
          console.error("[NotificationTool] Notification error:", e);
        }
      }, Math.max(0, delayMs || 0));
    };

    const init = () => {
      list.forEach(({ message, delay = 0, time }) => {
        log("Input", { message, delay, time });

        let delayMs = delay;
        if (time != null) {
          const target = parseWhen(time);
          if (target != null) {
            delayMs = target - Date.now();
            if (!Number.isFinite(delayMs)) delayMs = 0;
            if (delayMs < 0) {
              console.warn("[NotificationTool] Target is in the past; firing immediately.", { message, target });
              delayMs = 0;
            }
          } else {
            console.warn("[NotificationTool] Could not parse 'time'; using delay.", { message, time, delay });
          }
        }

        schedule(message, delayMs);
      });
      return "Notifications scheduled.";
    };

    if (Notification.permission === 'granted') {
      return init();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        log("Permission result", perm);
        if (perm === 'granted') init();
      });
      return "Notifications scheduled (pending permission).";
    } else {
      return "Permission denied for notifications.";
    }
  }`,
})

export const smallHelperTools = [jinaMarkdownReader, jinaSearch, clock, location, notification]
