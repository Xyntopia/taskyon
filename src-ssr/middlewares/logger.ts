import { defineSsrMiddleware } from '#q-app/wrappers'

// "async" is optional;
// more info on params: https://v2.quasar.dev/quasar-cli/developing-ssr/ssr-middlewares
export default defineSsrMiddleware(({ app, resolve /*, resolveUrlPath, publicPath, render */ }) => {
  // something to do with the server "app"
  app.all(resolve.urlPath('*'), (req, _: unknown, next) => {
    console.log('someone requested:', req.url)
    next()
  })
})
