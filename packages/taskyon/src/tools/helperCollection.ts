import { readResponsePrefix } from '@taskyon/common/modules/webFetching/readResponsePrefix'
import type { JSONSchema7 } from 'json-schema'
import type { FetchWithPolicy } from '@taskyon/common/modules/webFetching/mediatedFetch'
import { createTool } from '../types/toolApi'
import { parsePoliteHttpPolicy, politeFetch, politeHttpPolicySchema } from '../utils/politeHttp'

export const readPublicWebResource = async (
  url: string,
  httpPolicy: Parameters<typeof parsePoliteHttpPolicy>[0],
  request: FetchWithPolicy,
) => {
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('Web reader requires an absolute HTTP or HTTPS URL.')
  }
  const response = await politeFetch(
    target.href,
    { headers: { Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.8' } },
    parsePoliteHttpPolicy(httpPolicy),
    (input, init) => request(input, init, { preferProxy: true }),
  )
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`)
  }
  const contentType = response.headers.get('content-type') ?? 'unknown'
  if (contentType.toLowerCase().includes('pdf')) {
    const data = await readResponsePrefix(response,5)
    const header = new TextDecoder().decode(data.slice(0, 5))
    if (header !== '%PDF-') throw new Error('Web reader did not return valid PDF bytes')
    const reported = response.headers.get('content-length')
    const size = reported !== null && Number.isSafeInteger(Number(reported)) && Number(reported) >= 0
      ? `${reported} bytes (reported by server)` : 'not provided by server'
    return `Fetched PDF artifact\nURL: ${target.href}\nContent-Type: ${contentType}\nSize: ${size}\nHeader: ${header}`
  }
  return await response.text()
}

const webReader = createTool({
  description: 'Read a public HTTP or HTTPS resource through Taskyon mediated fetch.',
  longDescription:
    'Read a public web resource using Taskyon host authorization and transport settings. The host chooses direct, WSS, or a configured proxy; Tauri direct requests use native HTTP. Returns original page text or HTML without article normalization. For PDFs, checks the file signature and returns metadata rather than extracted text; use storage download/read to save and inspect the document.',
  name: 'webReader',
  renderOptions: { hideChat: false, hideLlm: false },
  parameters: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'The absolute HTTP or HTTPS resource URL.' },
      httpPolicy: politeHttpPolicySchema,
    },
  } as const satisfies JSONSchema7,
  function: async ({ url, httpPolicy }, context) => {
    if (!context.fetch) throw new Error('Mediated fetch is unavailable.')
    return await readPublicWebResource(url, httpPolicy, context.fetch)
  },
})

const clock = createTool({
  description: 'Return the local time, date, weekday, and seconds for now or a Unix timestamp.',
  name: 'clock',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
    hideVector: true,
    hideVectorResult: true,
    hideToolSearch: false,
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
    hideVector: true,
    hideToolSearch: false,
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

export const smallHelperTools = [webReader, clock, location, notification]
