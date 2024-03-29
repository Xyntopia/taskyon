/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/*
 * This file runs in a Node context (it's NOT transpiled by Babel), so use only
 * the ES6 features that are supported by your Node version. https://node.green/
 */

// Configuration for your app
// https://v2.quasar.dev/quasar-cli/quasar-conf-js

/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const { env } = require('process');
const { configure } = require('quasar/wrappers');

// check parent folder for configuration
const buildConfig = require('dotenv').config({
  path: '../build_configuration',
});

APPNAME = env.APPNAME || buildConfig.APPNAME || 'Taskyon';
DESCRIPTION = buildConfig.DESCRIPTION || '';

console.log('compile app: ', APPNAME, DESCRIPTION);

module.exports = configure(function (ctx) {
  return {
    // https://v2.quasar.dev/quasar-cli/supporting-ts
    supportTS: {
      tsCheckerConfig: {
        eslint: {
          enabled: true,
          files: './src/**/*.{ts,tsx,js,jsx,vue}',
        },
      },
    },

    // https://v2.quasar.dev/quasar-cli/prefetch-feature
    preFetch: true,

    // https://quasar.dev/quasar-cli/quasar-conf-js#property-vendor
    // if we include files such as "danfojs" the library gets huge, so we are disabling this
    vendor: {
      /* optional; we want a maximum of max ~200kb in the chunk when landing on our page in order to give users
         a "good" experience...  as things like danfojs alone are already at 9MB, it'll take a long time for users to make use of this,,
         therefore we should load those libraries lazily and only manually add some important libraries to the vendor chunk

         disables vendor chunk:*/ disable: true,

      /*remove: ['danfojs', 'vue$', 'amplify']
      // we need to remove large libraries that we don't need in our index page!!
      remove: [
        // remove danfojs dependencies (we can get them by checking the outnput of: yarn list):
        'xlsx','mathjs','@tensorflow','plotly.js-dist-min','danfojs', 'table',
        'json-schema-traverse', 'ajv',
        // non-initially-required aws amplify libraries
        '@aws-amplify/ui-vue/dist'
      ]*/
    },

    // app boot file (/src/boot)
    // --> boot files are part of "main.js"
    // https://v2.quasar.dev/quasar-cli/boot-files
    boot: [
      //TODO: 'addressbar-color',
      'i18n',
      'taskyon',
      //{path: 'payments', client: true, server: true }
      //'htmlDataStore'
    ],

    // https://v2.quasar.dev/quasar-cli/quasar-conf-js#Property%3A-css
    css: ['app.sass'],

    // https://github.com/quasarframework/quasar/tree/dev/extras
    extras: [
      // 'ionicons-v4',
      // 'mdi-v5',
      // 'fontawesome-v5',
      // 'eva-icons',
      // 'themify',
      // 'line-awesome',
      // 'roboto-font-latin-ext', // this or either 'roboto-font', NEVER both!

      'roboto-font', // optional, you are not bound to it
      'material-icons', // optional, you are not bound to it
      'mdi-v5',
    ],

    // specify variables for index.template.html
    htmlVariables: {
      // eslint-disable-next-line
      title: APPNAME,
      description: {
        prop: DESCRIPTION,
      },
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli/quasar-conf-js#Property%3A-build
    build: {
      uglifyOptions: {
        compress: { drop_console: true },
      },
      env: {
        APPNAME: APPNAME,
        DESCRIPTION: DESCRIPTION,
      },
      vueRouterMode: 'history', // available values: 'hash', 'history'
      vueLoaderOptions: {
        compilerOptions: {
          // this handles the whitespace for the q-markdown component.
          // we need this in order to be able to use newlines in q-markdown...
          isPreTag: (tag) => tag === 'pre ' || tag === 'q-markdown',
        },

        // there HAS to be  frontend_config file in the parent directory
        // for this to work!
        // TODO: better error message
      },
      extendWebpack(
        cfg,
        {
          /*isServer, isClient*/
        }
      ) {
        // use new webpack5 loaders for asset importing
        cfg.module.rules.push({
          test: /\.md/,
          type: 'asset/source',
        });

        // TODO: make sure these things are only used in the browser and not in the desktop app...
        /*cfg.node = {
            fs: 'empty',
          }*/

        cfg.module.rules.push({
          resolve: {
            fallback: { fs: false, net: false, tls: false },
          },
        });

        /*if (process.env.NODE_ENV === "production") {
            // ...
            cfg.plugins.push(
              new PrerenderSPAPlugin({
                // Required - The path to the webpack-outputted app to prerender.
                staticDir: path.join(__dirname, 'dist/spa'),
                // Required - Routes to render.
                routes: [
                  '/', // Homepage
                  // ...other routes
                  '/error-404' // 404 page, it works because this route doesn't actually exist
                ],
                postProcess: context => {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                    context.html = context.html
                      // Defer scripts
                      .replace(/<script (.*?)>/g, '<script $1 defer>')
                      .replace('id="app"', 'id="app" data-server-rendered="true"');
                    return context;
                }
              })
            );
          }*/
      },

      // transpile: false,

      // Add dependencies for transpiling with Babel (Array of string/regex)
      // (from node_modules, which are by default not transpiled).
      // Applies only if "transpile" is set to true.
      // transpileDependencies: [],

      // rtl: true, // https://v2.quasar.dev/options/rtl-support
      // preloadChunks: true,
      // showProgress: false,
      // gzip: true,
      //analyze: false,
      analyze: {
        analyzerMode: 'static', // static generates a static html file, 'server' has more options but can not be used with CI/CD
        reportFilename: '../analyze_report.html',
      }, // do this in order to debug our large bundle sizes...

      // Options below are automatically set depending on the env, set them if you want to override
      // extractCSS: false,

      // https://v2.quasar.dev/quasar-cli/handling-webpack
      // "chain" is a webpack-chain object https://github.com/neutrinojs/webpack-chain
      chainWebpack(chain) {
        // TODO: add better chunk code split behaviour
        if (ctx.prod) {
          chain.optimization.splitChunks({
            ...chain.optimization.get('splitChunks'),
            /*chunks: 'async',
            minSize: 20000, //Minimum size, in bytes, for a chunk to be generated.
            minChunks: 1, //The minimum times must a module be shared among chunks before splitting.
            maxAsyncRequests: 30,
            maxInitialRequests: 30,
            //Size threshold at which splitting is enforced and other restrictions (minRemainingSize,
            // maxAsyncRequests, maxInitialRequests) are ignored.
            //enforceSizeThreshold: 50000, [groups]
            //maxSize: 200000,// max size per (cache group)
            */
            minSize: 20000,
            cacheGroups: {
              vendor_initial: {
                test: /[\\/]node_modules[\\/]/, //(vue|@quasar|quasar|axios|core-js)[\\/]/,
                priority: 20,
                reuseExistingChunk: true,
                name: 'vendor',
                chunks: 'initial',
                //maxSize: 5000000,
                //maxAsyncSize: 1000000,
                //minSize: 1000000
              },
              vendor_whitelist: {
                test: /[\\/]node_modules[\\/](vue|quasar|axios|core-js)[\\/]/,
                priority: 20,
                reuseExistingChunk: true,
                name: 'vendor',
                chunks: 'all',
                //maxSize: 5000000,
                //maxAsyncSize: 1000000,
                //minSize: 1000000
              },
            },
          });
        }

        // this is in order to support the not-updated version of danfojs (and other libraries which need
        // polyfills) in webpack 5:
        // also read https://quasar.dev/start/upgrade-guide#nodejs-polyfills
        // and https://github.com/quasarframework/quasar/issues/9780
        // also needs:
        //    yarn add --dev node-polyfill-webpack-plugin browserify-zlib
        const nodePolyfillWebpackPlugin = require('node-polyfill-webpack-plugin');
        // we need the bwloe so that uglify can remove the console. because we want
        //  check this:  https://stackoverflow.com/questions/76979427/quasar-app-does-not-remove-console-log-for-production-builds
        // and this:  https://github.com/quasarframework/quasar/issues/11186
        chain
          .plugin('node-polyfill')
          .use(nodePolyfillWebpackPlugin, [{ excludeAliases: ['console'] }]);
        // chain.plugin('node-polyfill').use(nodePolyfillWebpackPlugin);
        // TODO: find out, why we did this?
        chain.resolve.alias.set('zlib', 'browserify-zlib');
      },
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli/quasar-conf-js#Property%3A-devServer
    devServer: {
      https: false,
      port: 8080,
      open: false, // opens browser window automatically
    },

    // https://v2.quasar.dev/quasar-cli/quasar-conf-js#Property%3A-framework
    framework: {
      iconSet: 'material-icons', // Quasar icon set
      lang: 'en-US', // Quasar language pack
      config: {
        dark: 'auto', // 'auto' or Boolean true/false
        // https://coolors.co/003459-c46e72-820263-061623-618b25-e43a64-b0bbbf-e6af2e
        // TODO: these colors are currently defined in ./css/quasar.variables.sass
        /* brand: {
          secondary: '#F78F3B',
          primary: '#2A3548',
          // darkaccent: '#7fa042',
          accent: '#7fa042',
          // lightaccent: '#8BA7B9',

          dark: '#0d1117',
          // lightshades: '#FBFAFB',

          positive: '#7fa042',
          negative: '#a04242',
          info: '#8BA7B9',
          warning: '#ff118c'
        } */
        notify: {
          /* look at QuasarConfOptions from the API card */
        },
      },
      // For special cases outside of where the auto-import strategy can have an impact
      // (like functional components as one of the examples),
      // you can manually specify Quasar components/directives to be available everywhere:
      //
      // components: [],
      // directives: [],

      // Quasar plugins
      plugins: [
        'LocalStorage',
        'Notify',
        //'SessionStorage'
        // TODO: 'AddressbarColor'
      ],
    },

    // animations: 'all', // --- includes all animations
    // https://v2.quasar.dev/options/animations
    animations: [],
    // Possible values for "importStrategy":
    // * 'auto' - (DEFAULT) Auto-import needed Quasar components & directives
    // * 'all'  - Manually specify what to import
    importStrategy: 'auto',
    // For special cases outside of where "auto" importStrategy can have an impact
    // https://v2.quasar.dev/quasar-cli/developing-ssr/configuring-ssr
    ssr: {
      pwa: false,

      // manualStoreHydration: true,
      // manualPostHydrationTrigger: true,

      prodPort: 3000, // The default port that the production server should use
      // (gets superseded if process.env.PORT is specified at runtime)

      maxAge: 5, //1000 * 60 * 60 * 24 * 30, // 1 month
      // Tell browser when a file from the server should expire from cache (in ms)

      chainWebpackWebserver(/* chain */) {
        //
      },

      middlewares: [
        ctx.prod ? 'compression' : '',
        'render', // keep this as last one
      ],
    },

    ssg: {
      // pass options here
      concurrency: 2, // we don't want to make to many requests simultanously to stripe
      interval: 10000,
    },

    // https://v2.quasar.dev/quasar-cli/developing-pwa/configuring-pwa
    pwa: {
      workboxPluginMode: 'GenerateSW', // 'GenerateSW' or 'InjectManifest'
      workboxOptions: {}, // only for GenerateSW

      // for the custom service worker ONLY (/src-pwa/custom-service-worker.[js|ts])
      // if using workbox in InjectManifest mode
      chainWebpackCustomSW(/* chain */) {
        //
      },

      manifest: {
        name: 'doxcavator',
        short_name: 'doxcavator',
        description: 'Document extraction tasks made easy',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F78F3B',
        theme_color: '#2A3548',
        icons: [
          {
            src: 'icons/icon-128x128.png',
            sizes: '128x128',
            type: 'image/png',
          },
          {
            src: 'icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-256x256.png',
            sizes: '256x256',
            type: 'image/png',
          },
          {
            src: 'icons/icon-384x384.png',
            sizes: '384x384',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli/developing-cordova-apps/configuring-cordova
    cordova: {
      // noIosLegacyBuildFlag: true, // uncomment only if you know what you are doing
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli/developing-capacitor-apps/configuring-capacitor
    capacitor: {
      hideSplashscreen: true,
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli/developing-electron-apps/configuring-electron
    electron: {
      bundler: 'packager', // 'packager' or 'builder'

      packager: {
        // https://github.com/electron-userland/electron-packager/blob/master/docs/api.md#options
        // OS X / Mac App Store
        // appBundleId: '',
        // appCategoryType: '',
        // osxSign: '',
        // protocol: 'myapp://path',
        // Windows only
        // win32metadata: { ... }
      },

      builder: {
        // https://www.electron.build/configuration/configuration

        appId: 'xyntopia',
      },

      // "chain" is a webpack-chain object https://github.com/neutrinojs/webpack-chain
      chainWebpack(/* chain */) {
        // do something with the Electron main process Webpack cfg
        // extendWebpackMain also available besides this chainWebpackMain
      },

      // "chain" is a webpack-chain object https://github.com/neutrinojs/webpack-chain
      chainWebpackPreload(/* chain */) {
        // do something with the Electron main process Webpack cfg
        // extendWebpackPreload also available besides this chainWebpackPreload
      },
    },
  };
});
