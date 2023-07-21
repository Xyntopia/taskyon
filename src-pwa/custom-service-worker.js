/*
 * This file (which will be your service worker)
 * is picked up by the build system ONLY if
 * quasar.conf > pwa > workboxPluginMode is set to "InjectManifest"
 */

import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst, Strategy } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import localForage from 'localforage'

var PostRequestCache = localForage.createInstance({
  name: 'PostRequestCache'
})

// precache skeleton of xyntopia
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

// cache components
// TODO: cache all other get requests
// TODO: pay attention here to the cachecontrol-maxage header coming from
// the app. It gives indications on whether we want to have cache
// or network policy
registerRoute(
  new RegExp('.*/components/.*'),
  new NetworkFirst({
    networkTimeoutSeconds: 3,
    cacheName: 'xyntopia-pages',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      })
    ]
  })
)

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

/*
this function takes sarch requests based on POST method
and goes for a cache-first strategy. TODO: it also pays
attention to the header and updates cache
according to cache-control values.
*/
class CacheFirstPostRequests extends Strategy {
  async _handle (request, handler) {
    const body = await request.clone().text() // can also be json() or blob()  etc...
    // eslint-disable-next-line
    const key = request.url + body.replace(/[{}\[\]_":,]/g, '') // shorten the response body to get a key
    // check if key exists in db
    var responsebody = null
    var config = null
    const cachedResponse = await PostRequestCache.getItem(key)
    if (cachedResponse === null) {
      const response = await handler.fetch(request)
      if ([200, 204].includes(response.status)) {
        config = {
          headers: serializeHeaders(response.headers),
          url: response.url,
          status: response.status,
          statusText: response.statusText
        }
        const cacheresponse = [
          await response.clone().text(),
          config
        ]
        console.log(key, cacheresponse)
        PostRequestCache.setItem(key, cacheresponse)
      }
      return response
    } else {
      config = cachedResponse[1]
      responsebody = cachedResponse[0]
      return Promise.resolve(new Response(responsebody || null, config))
    }
  }
}

registerRoute(
  new RegExp('.*search.*'),
  new CacheFirstPostRequests(),
  'POST'
)

console.log('Installed new xyntopia service worker!')

// Catch routing errors, like if the user is offline
/* setCatchHandler(async ({ event }) => {
    // Return the precached offline page if a document is being requested
    if (event.request.destination === 'document') {
      return matchPrecache('/offline.html');
    }

    return Response.error();
  });
*/
