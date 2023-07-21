import axios from 'axios';

// Be careful when using SSR for cross-request state pollution
// due to creating a Singleton instance here;
// If any client changes this (global) instance, it might be a
// good idea to move this instance creation inside of the
// "export default () => {}" function below (which runs individually
// for each client)

// TODO: we need to make sure we can change this value for our produxction app!
const MAX_REQUESTS_COUNT = 1; // MAX_REQUESTS_COUNT is the maximum number of requests at any given time.
const INTERVAL_MS = 100; //  interval time to check of there are vacant slots in the request queue
let PENDING_REQUESTS = 0; // initial pending requests counter

const api = axios.create({ baseURL: '' });

// Credit of snippet for axios concurrency control goes here:
// https://medium.com/@matthew_1129/axios-js-maximum-concurrent-requests-b15045eb69d0
/** Axios Request Interceptor
 */
api.interceptors.request.use(function (config) {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (PENDING_REQUESTS < MAX_REQUESTS_COUNT) {
        PENDING_REQUESTS++;
        clearInterval(interval);
        //console.log('downloading: ', config);
        resolve(config);
      }
    }, INTERVAL_MS);
  });
});

/**
 * Axios Response Interceptor for repeating request if they fail
 * a certain amount of times (MAX_REQUESTS_COUNT)
 */
api.interceptors.response.use(
  function (response) {
    PENDING_REQUESTS = Math.max(0, PENDING_REQUESTS - 1);
    return Promise.resolve(response);
  },
  function (error) {
    PENDING_REQUESTS = Math.max(0, PENDING_REQUESTS - 1);
    return Promise.reject(error);
  }
);

export { api };
