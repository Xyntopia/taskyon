/* eslint-env node */

// Configuration for your app
// https://v2.quasar.dev/quasar-cli-webpack/quasar-config-js

/* eslint-disable @typescript-eslint/no-var-requires */
import { configure } from 'quasar/wrappers';
import path from 'path';
import fs from 'fs';
// this is in order to support the not-updated version of danfojs (and other libraries which need
// polyfills) in webpack 5:
// also read https://quasar.dev/start/upgrade-guide#nodejs-polyfills
// and https://github.com/quasarframework/quasar/issues/9780
// also needs:
//    yarn add --dev node-polyfill-webpack-plugin browserify-zlib
import nodePolyfillWebpackPlugin from 'node-polyfill-webpack-plugin';

const APPNAME = 'taskyon';
const DESCRIPTION = 'Taskyon Generative Chat & Agent Hybrid';

console.log('compile app: ', APPNAME, DESCRIPTION);

// Function to copy the taskyon_settings.json file
function copyTaskyonSettings() {
  const srcPath = path.resolve(__dirname, 'src/assets/taskyon_settings.json');
  const destPath = path.resolve(__dirname, 'public/taskyon_settings.json');

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log('Copied taskyon_settings.json to public folder');
  } else {
    console.error('taskyon_settings.json not found in src/assets');
  }
}

export default configure((ctx) => {
  if (ctx.prod) {
    copyTaskyonSettings();
  }

  return {
    eslint: {
      // fix: true,
      // include: [],
      // exclude: [],
      // cache: false,
      // rawEsbuildEslintOptions: {},
      // rawWebpackEslintPluginOptions: {},
      warnings: true,
      errors: true,
    },
    // https://v2.quasar.dev/quasar-cli-webpack/prefetch-feature
    // preFetch: true,

    // https://quasar.dev/quasar-cli/quasar-conf-js#property-vendor
    // if we include files such as "danfojs" the library gets huge, so we are disabling this
    vendor: {
      /** optional; we want a maximum of max ~200kb in the chunk when landing on our page in order to give users
         a "good" experience...  as things like danfojs alone are already at 9MB, it'll take a long time for users to make use of this,,
         therefore we should load those libraries lazily and only manually add some important libraries to the vendor chunk

         disables vendor chunk:*/
      disable: true,
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
      //{path: 'payments', client: true, server: true }
      //'htmlDataStore'
    ],

    // https://v2.quasar.dev/quasar-cli/quasar-conf-js#Property%3A-css
    css: ['app.sass'],

    // https://github.com/quasarframework/quasar/tree/dev/extras
    extras: [
      // we don't use webfont icons anymore.. svg icons look better and support treeshaking
      // and make the app faster this way...
      // 'ionicons-v4',
      // 'mdi-v5',
      // 'fontawesome-v5',
      // 'eva-icons',
      // 'themify',
      // 'line-awesome',
      // 'roboto-font-latin-ext', // this or either 'roboto-font', NEVER both!
      'roboto-font', // optional, you are not bound to it
      //'material-icons', // optional, you are not bound to it
      //'mdi-v5',
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
      //publicPath:  '/', TODO: check if we ca us this to deploy a "test" version of our app on gitlab pages..
      vueRouterMode: 'history', // available values: 'hash', 'history'

      uglifyOptions: {
        compress: { drop_console: true },
      },
      env: {
        APPNAME: APPNAME,
        DESCRIPTION: DESCRIPTION,
      },
      //devtool: 'source-map', // TODO: turn this off for actua production...
      vueLoaderOptions: {
        compilerOptions: {
          // from here: https://qmarkdown.netlify.app/all-about-qmarkdown/installation-types
          // this handles the whitespace for the q-markdown component.
          // we need this in order to be able to use newlines in q-markdown...
          // update: 20240608: we are shutting this down for now, because w have a lot of problems with
          // q-markdown and new lines..  maybe this is a related problem?
          // isPreTag: (tag) => tag === 'pre ' || tag === 'q-markdown',
        },

        // there HAS to be  frontend_config file in the parent directory
        // for this to work!
        // TODO: better error message
      },
      extendWebpack(
        cfg,
        {
          /*isServer, isClient*/
        },
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

        // Add chunkFilename option
        // make sure all our chunks are named in a nicer way :)
        /*cfg.output = {
          ...cfg.output,
          chunkFilename: 'js/[name].[chunkhash:8].js',
        };*/

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

      // webpackTranspile: false,

      // Add dependencies for transpiling with Babel (Array of string/regex)
      // (from node_modules, which are by default not transpiled).
      // Applies only if "webpackTranspile" is set to true.
      // webpackTranspileDependencies: [],

      esbuildTarget: {
        browser: ['es2022', 'firefox115', 'chrome115', 'safari14'],
        node: 'node20',
      },

      // rtl: true, // https://quasar.dev/options/rtl-support
      // preloadChunks: true,
      // showProgress: false,
      // gzip: true,
      //analyze: false,
      // also check this page:  https://webpack-stats-viewer.moonrailgun.com/   to see where large chunks get loaded from...
      analyze: {
        analyzerMode: 'static', // static generates a static html file, 'server' has more options but can not be used with CI/CD
        reportFilename: '../analyze_report.html',
        generateStatsFile: true, // in stats.json
        statsFilename: '../stats.json',
      }, // do this in order to debug our large bundle sizes...

      // Options below are automatically set depending on the env, set them if you want to override
      // extractCSS: false,

      // https://v2.quasar.dev/quasar-cli-webpack/handling-webpack
      // "chain" is a webpack-chain object https://github.com/sorrycc/webpack-chain
      // https://webpack.js.org/plugins/split-chunks-plugin/#splitchunkschunks
      chainWebpack(chain) {
        // TODO: add better chunk code split behaviour
        if (ctx.prod) {
          chain.optimization.splitChunks({
            //...chain.optimization.get('splitChunks'),
            /*chunks: 'all',
            minRemainingSize: 0,
            minChunks: 1,
            maxAsyncRequests: 30,
            maxInitialRequests: 2,
            enforceSizeThreshold: 50000,
            name: 'rest',*/
            //minSize: 20000,
            minSize: 50000,
            maxInitialRequests: 2,
            hidePathInfo: false,
            cacheGroups: {
              page: {
                name: 'page',
                test: /src[\\/](pages|layout|router)/,
                //test: /[\\/]src[\\/](pages|layout)[\\/]/,
                priority: 25,
                reuseExistingChunk: true,
                enforce: true,
                chunks: 'all',
                minChunks: 1,
              },
              taskyon: {
                name: 'taskyon',
                test: /src[\\/](modules)/,
                //test: /[\\/]src[\\/](pages|layout)[\\/]/,
                priority: 20,
                reuseExistingChunk: true,
                enforce: true,
                chunks: 'all',
                minChunks: 1,
              },
              components: {
                name: 'components',
                test: (module) => {
                  const name = module.resource;
                  const valid = /src[\\/](components|assets)/.test(name);
                  return valid;
                },
                //test: /[\\/]src[\\/](pages|layout)[\\/]/,
                priority: 25,
                reuseExistingChunk: true,
                enforce: true,
                chunks: 'all',
                minChunks: 1,
              },
              vendor_whitelist: {
                test: /[\\/]node_modules[\\/](vue|quasar|core-js)[\\/]/,
                priority: 30,
                reuseExistingChunk: true,
                name: 'vendor',
                chunks: 'all',
              },
              libs: {
                /*name(module, chunks, cacheGroupKey) {
                  // this gives us the concrete filenames for each module:
                  const moduleFileName = module
                    .identifier()
                    .split('node_modules')
                    .reduceRight((item) => item)
                    .replace(/[\\/]/g, '.');

                  // Get the largest chunk's name
                  //const largestChunkName = largestChunk.name;

                  //return `l-${largestChunkName}-${moduleFileName}`;
                  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                  return `l-${moduleFileName}`; // we can use this for debugging purposes...
                },*/
                test: /[\\/]node_modules[\\/]/,
                priority: 10,
                reuseExistingChunk: true,
                chunks: 'all',
                minSize: 50000,
              },
              commons: {
                name: 'initial',
                chunks: 'initial',
                minChunks: 1,
                priority: 40,
                enforce: true, // Ensure this chunk is always created
              },
              json: {
                type: 'json',
                name: 'json',
              },
            },
          });
        }

        // we need the bwloe so that uglify can remove the console. because we want
        //  check this:  https://stackoverflow.com/questions/76979427/quasar-app-does-not-remove-console-log-for-production-builds
        // and this:  https://github.com/quasarframework/quasar/issues/11186
        if (ctx.prod) {
          chain
            .plugin('node-polyfill')
            .use(nodePolyfillWebpackPlugin, [{ excludeAliases: ['console'] }]);
        } else {
          chain.plugin('node-polyfill').use(nodePolyfillWebpackPlugin);
        }
        // TODO: find out, why we did this?
        //chain.resolve.alias.set('zlib', 'browserify-zlib');
      },
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-webpack/quasar-config-js#Property%3A-devServer
    devServer: {
      server: {
        type: 'http',
      },
      open: false, // opens browser window automatically
      setupMiddlewares(middlewares, devServer) {
        if (!devServer) {
          throw new Error('webpack-dev-server is not defined');
        }

        devServer.middleware.waitUntilValid(() => {
          copyTaskyonSettings();
        });

        return middlewares;
      },
    },

    // https://v2.quasar.dev/quasar-cli-webpack/quasar-config-js#Property%3A-framework
    framework: {
      // https://quasar.dev/vue-components/icon#options-api
      iconSet: 'svg-material-icons',
      lang: 'en-US', // Quasar language pack
      config: {
        dark: 'auto', // 'auto' or Boolean true/false
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
    // https://quasar.dev/options/animations
    animations: [],

    // https://v2.quasar.dev/quasar-cli-webpack/quasar-config-js#property-sourcefiles
    // sourceFiles: {
    //   rootComponent: 'src/App.vue',
    //   router: 'src/router/index',
    //   store: 'src/store/index',
    //   indexHtmlTemplate: 'index.html',
    //   pwaRegisterServiceWorker: 'src-pwa/register-service-worker',
    //   pwaServiceWorker: 'src-pwa/custom-service-worker',
    //   pwaManifestFile: 'src-pwa/manifest.json',
    //   electronMain: 'src-electron/electron-main',
    //   electronPreload: 'src-electron/electron-preload'
    //   bexManifestFile: 'src-bex/manifest.json
    // },

    // https://v2.quasar.dev/quasar-cli-webpack/developing-ssr/configuring-ssr
    ssr: {
      prodPort: 3000, // The default port that the production server should use
      // (gets superseded if process.env.PORT is specified at runtime)

      middlewares: [
        'render', // keep this as last one
      ],

      // extendPackageJson (json) {},
      // extendSSRWebserverConf (esbuildConf) {},

      // manualStoreSerialization: true,
      // manualStoreSsrContextInjection: true,
      // manualStoreHydration: true,
      // manualPostHydrationTrigger: true,

      pwa: false,

      // pwaOfflineHtmlFilename: 'offline.html', // do NOT use index.html as name!
      // will mess up SSR

      // pwaExtendGenerateSWOptions (cfg) {},
      // pwaExtendInjectManifestOptions (cfg) {}
    },

    // https://v2.quasar.dev/quasar-cli-webpack/developing-pwa/configuring-pwa
    pwa: {
      workboxMode: 'GenerateSW', // 'GenerateSW' or 'InjectManifest'
      // swFilename: 'sw.js',
      // manifestFilename: 'manifest.json'
      // extendManifestJson (json) {},
      // useCredentialsForManifestTag: true,
      // injectPwaMetaTags: false,
      // extendPWACustomSWConf (esbuildConf) {},
      // extendGenerateSWOptions (cfg) {},
      // extendInjectManifestOptions (cfg) {}
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-webpack/developing-cordova-apps/configuring-cordova
    cordova: {
      // noIosLegacyBuildFlag: true, // uncomment only if you know what you are doing
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-webpack/developing-capacitor-apps/configuring-capacitor
    capacitor: {
      hideSplashscreen: true,
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-webpack/developing-electron-apps/configuring-electron
    electron: {
      // extendElectronMainConf (esbuildConf) {},
      // extendElectronPreloadConf (esbuildConf) {},

      // extendPackageJson (json) {},

      // Electron preload scripts (if any) from /src-electron, WITHOUT file extension
      preloadScripts: ['electron-preload'],

      // specify the debugging port to use for the Electron app when running in development mode
      inspectPort: 5858,

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

      // Full list of options: https://v2.quasar.dev/quasar-cli-webpack/developing-browser-extensions/configuring-bex
      bex: {
        // extendBexScriptsConf (esbuildConf) {},
        // extendBexManifestJson (json) {},

        contentScripts: ['my-content-script'],
      },
    },
  };
});
