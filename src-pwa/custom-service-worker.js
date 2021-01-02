/*
 * This file (which will be your service worker)
 * is picked up by the build system ONLY if
 * quasar.conf > pwa > workboxPluginMode is set to "InjectManifest"
 */

import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { /* NetworkFirst, */ CacheFirst, Strategy } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import localForage from 'localforage'

var PostRequestCache = localForage.createInstance({
  name: 'PostRequestCache'
})

// precache skeleton of componardo
precacheAndRoute(self.__WB_MANIFEST)

// Cache images with a Cache First strategy
registerRoute(
  // Check to see if the request's destination is style for an image
  ({ request }) => request.destination === 'image',
  // Use a Cache First caching strategy
  new CacheFirst({
    // Put all cached files in a cache named 'images'
    cacheName: 'images',
    plugins: [
      // Ensure that only requests that result in a 200 status are cached
      new CacheableResponsePlugin({
        statuses: [200]
      }),
      // Don't cache more than 50 items, and expire them after 30 days
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 24 * 30 // 30 Days
      })
    ]
  })
)

// cache all other get requests
// TODO: pay attention here to the maxage header coming from
// the app. It gives indications on whether we want to have cache
// or network policy
/* registerRoute(
  ({ request }) => {
    // console.log('handling request: ' + request.url)
    if (!request.url.includes('service-worker.js')) {
      // console.log(request)
      return true
    }
  },
  new NetworkFirst({
    networkTimeoutSeconds: 3,
    cacheName: 'componardo-pages',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      })
    ]
  })
) *?

/* class NewNetworkOnlyStrategy extends Strategy {
  _handle (request, handler) {
    return handler.fetch(request)
  }
} */

function serializeHeaders (headers) {
  var serialized = {}
  // `for(... of ...)` is ES6 notation but current browsers supporting SW, support this
  // notation as well and this is the only way of retrieving all the headers.
  for (var entry of headers.entries()) {
    serialized[entry[0]] = entry[1]
  }
  return serialized
}

async function toCache (request, response) {
  const body = await request.text() // can also be json() or blob()  etc...
  // eslint-disable-next-line
  const key = request.url + body.replace(/[{}\[\]_":,]/g, '') // shorten the response body to get a key
  const json = await response.json()
  const cachedresponse = [
    json,
    serializeHeaders(response.headers)
  ]
  console.log(key, cachedresponse)
  PostRequestCache.setItem(key, cachedresponse)
}

class CacheFirstPostRequests extends Strategy {
  _handle (request, handler) {
    const responsepromise = handler.fetch(request.clone())
    responsepromise.then(response => {
      toCache(request, response.clone())
    })
    // console.log(`Load response from cache.`);
    // return new Response(JSON.stringify(data.response.body), data.response);
    return responsepromise
  }
}

registerRoute(
  ({ request }) => {
    console.log('handling POST request: ' + request.url)
    // request.url
    return true
  },
  new CacheFirstPostRequests(),
  'POST'
)

console.log('Installed new componardo service worker!')

// cache all request
/* registerRoute(
  ({ request }) => {
    return request.method === 'GET'
  },
  new NetworkFirst()
) */

// Catch routing errors, like if the user is offline
/* setCatchHandler(async ({ event }) => {
    // Return the precached offline page if a document is being requested
    if (event.request.destination === 'document') {
      return matchPrecache('/offline.html');
    }

    return Response.error();
  });
*/
