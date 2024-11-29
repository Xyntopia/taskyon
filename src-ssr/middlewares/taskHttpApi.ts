import { defineSsrMiddleware } from '#q-app/wrappers'

// "async" is optional;
// more info on params: https://v2.quasar.dev/quasar-cli/developing-ssr/ssr-middlewares
export default defineSsrMiddleware(async ({ app /*, resolveUrlPath, publicPath, render */ }) => {
  // something to do with the server "app"
})
