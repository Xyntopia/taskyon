import type { JSONSchema7 } from 'json-schema'
import { createTool } from '../types/toolApi'
import { parsePoliteHttpPolicy, politeFetch, politeHttpPolicySchema } from '../utils/politeHttp'
import { canUseTauriHttpPlugin, tauriHttpGetText } from '../utils/tauriHttpPlugin'

const jinaMarkdownReader = createTool({
  description: 'Read a public web page as normalized Markdown through Jina Reader.',
  longDescription:
    'The page is fetched through the external r.jina.ai reader service rather than directly from the browser, which can simplify article content but sends the target URL to Jina.',
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
      httpPolicy: politeHttpPolicySchema,
    },
  } as const satisfies JSONSchema7,
  function: async ({ url, httpPolicy }) => {
    if (typeof url !== 'string') throw new Error('jinaMarkdownReader requires a string URL.')
    const response = await politeFetch(
      `https://r.jina.ai/${url}`,
      undefined,
      parsePoliteHttpPolicy(httpPolicy),
    )
    return await response.text()
  },
})

const tauriHttpWebReader = createTool({
  description: 'Read an HTTP or HTTPS page directly through the Tauri desktop network runtime.',
  longDescription:
    'This desktop-only capability uses the Tauri HTTP plugin rather than browser fetch, so ordinary browser CORS restrictions do not apply. Requests still follow Taskyon’s polite HTTP policy and return the remote response body without article normalization.',
  name: 'tauriHttpWebReader',
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
        description: 'The absolute URL of the website resource to download.',
      },
      httpPolicy: politeHttpPolicySchema,
    },
  } as const satisfies JSONSchema7,
  function: async ({ url, httpPolicy }) => {
    if (!canUseTauriHttpPlugin()) {
      throw new Error('tauriHttpWebReader is only available in Tauri desktop runtime')
    }

    const target = String(url).trim()
    if (!/^https?:\/\//i.test(target)) {
      throw new Error(`Invalid URL '${target}'. Please provide an absolute http(s) URL.`)
    }

    const parsedHttpPolicy = parsePoliteHttpPolicy(httpPolicy)
    const response = await tauriHttpGetText(target, {
      ...(parsedHttpPolicy ? { httpPolicy: parsedHttpPolicy } : {}),
    })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Tauri HTTP request failed: ${response.status} ${response.statusText}`)
    }
    return response.body
  },
})

// TODO: add more functionality from here:   https://r.jina.ai/docs
// TODO: add a state how many tokesn we have left over :)
export const jinaSearch = createTool({
  description: 'Search the web through the authenticated Jina Search API.',
  longDescription:
    'The API key is requested through Taskyon’s secret boundary and sent to the external Jina service. Results are normalized to titles, descriptions, and URLs rather than returning the raw provider payload.',
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
      httpPolicy: politeHttpPolicySchema,
    },
  } as const satisfies JSONSchema7,
  function: async ({ query, httpPolicy }, ctx) => {
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
      const response = await politeFetch(
        `https://s.jina.ai/?q=${encodeURIComponent(query)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-Respond-With': 'no-content',
            Accept: 'application/json',
            'X-With-Favicons': 'true',
          },
        },
        parsePoliteHttpPolicy(httpPolicy),
      )
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
  description: 'Return the local time, date, weekday, and seconds for now or a Unix timestamp.',
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
  description:
    'Request browser geolocation and return coordinates, public IP, and an IP-based location estimate.',
  longDescription:
    'This browser-only tool prompts for precise geolocation permission, then sends the public IP to external IP and geolocation services. It fails when geolocation is unavailable or denied.',
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
  description: 'Schedule one or more browser notifications for immediate or future display.',
  longDescription:
    'Notifications use the browser permission boundary and the operating system notification area when supported. Scheduling is local to the running browser session; time-only values use local time and roll to tomorrow when already past.',
  name: 'notification',
  renderOptions: { hideChat: false, hideLlm: false },
  parameters: {
    type: 'object',
    properties: {
      // Single notification fields
      message: { type: 'string', description: 'Notification text.' },
      delay: {
        type: 'number',
        description: 'Delay in milliseconds before showing. Ignored if `time` is provided.',
      },
      time: {
        type: ['string', 'number'],
        description:
          'When to show: ISO string, epoch (ms or s), or time-only (e.g. "1pm", "13:00", "13:00:30"). Time-only uses LOCAL today (rolls to tomorrow if already passed).',
      },
      // Batch scheduling: provide a list of notifications
      list: {
        type: 'array',
        description:
          'List of notifications to schedule. Each item is like the single notification fields.',
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
              type: ['string', 'number'],
              description:
                'When to show: ISO string, epoch (ms or s), or time-only (e.g. "1pm", "13:00", "13:00:30"). Time-only uses LOCAL today (rolls to tomorrow if already passed).',
            },
          },
        },
      },
    },
  },
  code: `({ list, message, time, delay }) => {
    const log = (...args) => console.log("[NotificationTool]", ...args);

    // ---- normalize input to a list ----
    const items = Array.isArray(list) ? list : (
      typeof message === 'string' ? [{ message, time, delay }] : []
    );
    if (!items.length) return "No notifications provided.";

    const isEpochSeconds = (n) => Number.isFinite(n) && n < 1e12;
    const timeOnlyRe = /^\\s*(\\d{1,2})(?::(\\d{2}))?(?::(\\d{2}))?\\s*(am|pm)?\\s*$/i;

    const parseWhen = (input) => {
      if (input == null) return null;

      if (typeof input === 'number') {
        const ms = isEpochSeconds(input) ? input * 1000 : input;
        log("Parsed numeric epoch", { input, ms });
        return ms;
      }

      if (typeof input === 'string') {
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
            now.getFullYear(), now.getMonth(), now.getDate(),
            H, M, S, 0
          ).getTime();
          const final = (target <= Date.now()) ? target + 86400000 : target;
          log("Parsed time-only ->", { input, todayTarget: target, rolledTo: final, localNow: new Date() });
          return final;
        }
        const t = Date.parse(input);
        if (!Number.isNaN(t)) {
          log("Parsed date string", { input, parsed: t, as: new Date(t) });
          return t;
        }
        log("Unrecognized time format", { input });
        return null;
      }
      return null;
    };

    const schedule = (msg, delayMs) => {
      log("Scheduling", { msg, delayMs });
      setTimeout(() => {
        try {
          log("Triggering", { msg, at: new Date() });
          new Notification(msg);
        } catch (e) {
          console.error("[NotificationTool] Notification error:", e);
        }
      }, Math.max(0, delayMs || 0));
    };

    const init = () => {
      items.forEach(({ message: msg, delay = 0, time }) => {
        log("Input", { msg, delay, time });
        let delayMs = delay;
        if (time != null) {
          const target = parseWhen(time);
          if (target != null) {
            delayMs = target - Date.now();
            if (!Number.isFinite(delayMs) || delayMs < 0) delayMs = 0;
          } else {
            console.warn("[NotificationTool] Could not parse 'time'; using delay.", { msg, time, delay });
          }
        }
        schedule(msg, delayMs);
      });
      return "Notifications were successfully scheduled.";
    };

    if (Notification.permission === 'granted') {
      return init();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        log("Permission result", perm);
        if (perm === 'granted') init();
      });
      return "Notifications were successfully scheduled (pending permission).";
    } else {
      return "Permission denied for notifications tool.";
    }
  }`,
})

const webReaderTool = canUseTauriHttpPlugin() ? tauriHttpWebReader : jinaMarkdownReader
export const smallHelperTools = [webReaderTool, clock, location, notification]
