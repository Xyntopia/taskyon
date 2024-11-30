import { defineSsrMiddleware } from '#q-app/wrappers';
import type { Request, NextFunction } from 'express';

// "async" is optional;
// more info on params: https://v2.quasar.dev/quasar-cli/developing-ssr/ssr-middlewares
export default defineSsrMiddleware(
  async ({ app, resolve /*, resolveUrlPath, publicPath, render */ }) => {
    // something to do with the server "app"
    app.all(
      resolve.urlPath('*'),
      (req: Request, _: unknown, next: NextFunction) => {
        console.log('someone requested:', req.url);
        next();
      },
    );
  },
);
