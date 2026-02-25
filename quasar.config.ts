// Configuration for your app
// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file

import { defineConfig } from '#q-app/wrappers'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// --- helper to copy pyodide runtime ---
function viteStaticCopyPyodide() {
  const pyodideDir = dirname(fileURLToPath(import.meta.resolve('pyodide')))
  const pyodidePkg = JSON.parse(readFileSync(join(pyodideDir, 'package.json'), 'utf-8'))
  const pyodideVersion = pyodidePkg.version
  console.log('Detected Pyodide version:', pyodideVersion)

  /*const micropipDir = fileURLToPath(
    new URL('./vendor/pyodide-wheels/micropip-*.whl', import.meta.url),
  )*/

  return viteStaticCopy({
    targets: [
      {
        src: [join(pyodideDir, '*')],
        dest: 'assets/pyodide',
      },
      /*{
        src: [micropipDir],
        dest: 'assets/pyodide',
      },*/
    ],
  })
}

const here = dirname(fileURLToPath(import.meta.url))

function getGitCommitHash() {
  try {
    // Try to fetch commit hash locally
    // we need to expicitly specify 8 chars, because git default behaves differently on different OS.
    console.log('detecting current commit hash.')
    const commitHash = execSync(`git -C ${here} rev-parse --short=8 HEAD`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    console.log('building:', commitHash)
    return commitHash
  } catch (err) {
    console.warn('Unable to fetch Git commit hash locally:', err)

    // Check if we're in GitLab CI
    if (process.env.CI_COMMIT_SHORT_SHA) {
      console.log('Using GitLab CI commit hash')
      return process.env.CI_COMMIT_SHORT_SHA // Fallback to GitLab CI environment variable
    }

    // Fallback to a default value if no hash is available
    console.warn('No commit hash available; using default')
    return 'unknown'
  }
}

const commitHash = getGitCommitHash()
const APPNAME = 'taskyon'
const DESCRIPTION = 'Taskyon Generative Chat & Agent Hybrid'

console.log('compile app: ', APPNAME, DESCRIPTION)

// Custom plugin to adjust sourcemaps and add banner comment
/*function sourcemapBannerPlugin(): Plugin {
  return {
    name: 'sourcemap-banner-plugin',
    generateBundle(this, options, bundle) {
      // Update JS chunks: remove auto sourcemap comment and add our banner
      for (const fileName in bundle) {
        const chunk = bundle[fileName]!
        if (chunk.type === 'chunk') {
          // Remove default sourcemap comment(s)
          chunk.code = chunk.code.replace(/\/\/# sourceMappingURL=.*$/gm, '')
          // Append our custom sourcemap URL pointing to localhost with commitHash
          chunk.code += `\n//# sourceMappingURL=http://localhost:4000/sourcemaps/${chunk.name}.${commitHash}.map`
        }
      }
      if (process.env.SOURCEMAP === 'true') {
        // Rename sourcemap assets to be under "sourcemaps/" with our naming pattern
        for (const fileName of Object.keys(bundle)) {
          const asset = bundle[fileName]!
          if (asset.type === 'asset' && fileName.endsWith('.map')) {
            const baseName = fileName.slice(0, -4) // remove '.map'
            const newFileName = `sourcemaps/${baseName}.${commitHash}.map`
            asset.fileName = newFileName
            // Remove the old key and add the new one in the bundle
            delete bundle[fileName]
            bundle[newFileName] = asset
          }
        }
      }
    },
  }
}*/

export default defineConfig((ctx) => {
  /*if (ctx.prod) {
    copyFiles(filesToCopy)
  }*/

  const droplogging = ctx.prod && process.env.LOGGING !== 'true'
  console.log('drop logging:', droplogging)
  console.log('generate sourcemap:', process.env.SOURCEMAP)

  return {
    // https://v2.quasar.dev/quasar-cli-vite/prefetch-feature
    // preFetch: true,

    // app boot file (/src/boot)
    // --> boot files are part of "main.js"
    // https://v2.quasar.dev/quasar-cli-vite/boot-files
    boot: [
      // make sure brand colors are loaded "on-time" :)
      { server: false, path: 'brand-colors' },
      //TODO: 'addressbar-color',
      'i18n',
      //{path: 'payments', client: true, server: true }
      //'htmlDataStore'
    ],

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#css
    css: ['app.sass'],

    // https://github.com/quasarframework/quasar/tree/dev/extras
    extras: [
      // we don't use webfont icons anymore.. svg icons look better and support treeshaking
      // and make the app faster this way...
      // 'ionicons-v4',
      // 'mdi-v7',
      // 'fontawesome-v6',
      // 'eva-icons',
      // 'themify',
      // 'line-awesome',
      // 'roboto-font-latin-ext', // this or either 'roboto-font', NEVER both!

      'roboto-font', // optional, you are not bound to it
      //'material-icons', // optional, you are not bound to it
      //'mdi-v5',
    ],

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#build
    build: {
      target: {
        browser: ['es2022', 'firefox115', 'chrome115', 'safari14'],
        node: 'node20',
      },

      typescript: {
        strict: true,
        vueShim: true,
        extendTsConfig(ts) {
          // 1) Narrow Quasar's very broad include so vue-tsc doesn't crawl packages/**
          ts.include?.push(
            './../packages/taskyon/src/**/*',
            //'./**/*.d.ts',
            //'../src',
            //'../src/**/*.vue',
            //'../env.d.ts',
            //'../.quasar/**/*.d.ts',
          )

          // for some reason, adding references here doesn't work very well...
          //ts.files = []
          //ts.references = [{ path: './packages/taskyon' }, { path: './packages/tyclient' }]

          // // Be explicit about exclusions (prevents TS6305 looking into dist or packages)
          ts.exclude = [
            ...(ts.exclude ?? []),
            './../dist-desktop',
            './../src-tauri',
            './../packages/rumoca',
            './../packages/taskyon-vscode',
            //'./../packages/**', // <- key bit: keep workspace packages out
          ]

          // // 2) Keep the 'app' alias but scope it to the app, not the entire repo
          // // (prevents auto-imports like 'app/packages/taskyon/...'; still allows 'app/src/...').
          // ts.compilerOptions ??= {}
          // ts.compilerOptions.moduleResolution = 'bundler' // good with Vite + ESM
          // ts.compilerOptions.paths ??= {}

          // // leave 'app' (root) if you use it; just tighten the wildcard
          // if (ts.compilerOptions.paths['app/*']) {
          //   ts.compilerOptions.paths['app/*'] = ['../src/*']
          // }
          // // (optional) you can also remove it completely:
          delete ts.compilerOptions?.paths['app']
          delete ts.compilerOptions?.paths['app/*']

          // we can't do this, because we want everything to be under
          // @ŧaskyon/taskyon package :)
          /*if (ts.compilerOptions?.paths) {
            ts.compilerOptions.paths.taskyon = ['./../packages/taskyon/src']
            ts.compilerOptions.paths['taskyon/*'] = ['./../packages/taskyon/src/*']
          }*/
          return ts
        },
      },

      //publicPath:  '/', TODO: check if we can use this to deploy a "test" version of our app on gitlab pages..
      vueRouterMode: 'history', // available values: 'hash', 'history'
      // vueRouterBase,
      // vueDevtools,
      // vueOptionsAPI: false,

      // rebuildCache: true, // rebuilds Vite/linter/etc cache on startup

      // publicPath: '/',
      analyze: true,

      // not sure, if we need this here...
      // we need the as unknown as boolean due to a bug in quasar
      sourcemap: process.env.SOURCEMAP === 'true' ? ('true' as unknown as boolean) : false,
      env: {
        PUBLISH_DATE: new Date().toISOString(),
        COMMIT_HASH: commitHash,
      },
      // env: {},
      // rawDefine: {}
      // ignorePublicFolder: true,
      // minify: false,
      // polyfillModulePreload: true,
      // distDir

      extendViteConf(viteConf) {
        // *******  get rid of console.log in prod mode ****
        // Add this for dropping console and debugger in production:
        // TODO: https://github.com/evanw/esbuild/issues/3656  only drop console.log/info
        // TODO: write a custom logging library and then drop those calls as well
        viteConf.esbuild = viteConf.esbuild || {}
        viteConf.esbuild.drop = droplogging ? ['console', 'debugger'] : []

        // ********   configure pglite ********/
        // https://pglite.dev/docs/bundler-support
        // Extend the Vite configuration to exclude dependencies from optimization
        viteConf.optimizeDeps = {
          ...viteConf.optimizeDeps,
          exclude: [...(viteConf.optimizeDeps?.exclude ?? []), '@electric-sql/pglite', 'pyodide'],
        }

        viteConf.plugins = [
          viteConf.plugins,
          ...viteStaticCopyPyodide(),
          viteStaticCopy({
            targets: [
              {
                src: 'src/assets/taskyon_settings.json',
                dest: '.', // Will be placed in the root of the output dir ('public')
              },
              {
                src: 'README.md',
                dest: 'docs', // Will be placed in 'public/docs'
              },
            ],
          }),
        ]
        // ****   make our old taskyon workers "work" in vite
        // TODO: check if w need this extendedConf
        // we might be able to get rid of it...
        viteConf.worker = viteConf.worker || {}

        // we have to do the next thing, to ensure, we don't get this error:
        // [vite:worker-import-meta-url] Invalid value "iife" for option "worker.format" - UMD and IIFE output formats are not supported for code-splitting builds.
        // check https://github.com/vitejs/vite/issues/18585 for more infos
        viteConf.worker.format = 'es' // Ensure workers use ES module format
        //*******    end of worker config */
      },
      // viteVuePluginOptions: {},

      vitePlugins: [
        // the 'vite-plugin-wasm' and 'vite-plugin-top-level-await' plugins are necessary
        // to make wasm packages work which were built with wasm-pack / wasm-bindgen
        // top-level-await is needed, because wasm-pack generates async init functions
        // to load the wasm binary which we would also like to use in older browsers which don't
        // support top-level-await natively.
        // ['vite-plugin-wasm'],
        // ['vite-plugin-top-level-await'],
        // Only apply this plugin in production when sourcemaps are enabled
        // not sure, if we need it right now...
        // ...(ctx.prod ? [sourcemapBannerPlugin()] : []),

        // https://www.npmjs.com/package/vite-bundle-analyzer
        // TODO: re-enable this!
        /*analyzer({
          openAnalyzer: true, // Automatically open the analyzer UI in your browser
          summary: true, // Set to true if you prefer just a summary
          fileName: '../analyze_report',
          analyzerMode: 'static', // we use static here so that it also works in a CI setting.
          // Other options can go here if needed.
        }),*/
        [
          '@intlify/unplugin-vue-i18n/vite',
          {
            // if you want to use Vue I18n Legacy API, you need to set `compositionOnly: false`
            // compositionOnly: false,

            // if you want to use named tokens in your Vue I18n messages, such as 'Hello {name}',
            // you need to set `runtimeOnly: false`
            // runtimeOnly: false,

            ssr: ctx.modeName === 'ssr',

            // you need to set i18n resource including paths !
            include: [fileURLToPath(new URL('./src/i18n', import.meta.url))],
          },
        ],

        [
          'vite-plugin-checker',
          {
            vueTsc: true,
            eslint: {
              lintCommand: [
                'eslint',
                '-c ./eslint.config.js',
                '"./src/**/*.{ts,js,mjs,cjs,vue}"',
                '"./packages/{taskyon,tyclient,secure-tunnel}/src/**/*.{ts,js,mjs,cjs,vue}"',
              ].join(' '),
              useFlatConfig: true,
            },
          },
          { server: false },
        ],
      ],
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#devserver
    devServer: {
      // https: true
      //vueDevtools: true,
      https: process.env.TASKYON_HTTP ? false : true,
      open: false, // opens browser window automatically
    },

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#framework
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
        'Meta',
        'Dialog',
        //'SessionStorage'
        // TODO: 'AddressbarColor'
      ],
    },

    // animations: 'all', // --- includes all animations
    // https://v2.quasar.dev/options/animations
    animations: ['fadeOut', 'fadeIn'],

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#sourcefiles
    // sourceFiles: {
    //   rootComponent: 'src/App.vue',
    //   router: 'src/router/index',
    //   store: 'src/store/index',
    //   pwaRegisterServiceWorker: 'src-pwa/register-service-worker',
    //   pwaServiceWorker: 'src-pwa/custom-service-worker',
    //   pwaManifestFile: 'src-pwa/manifest.json',
    //   electronMain: 'src-electron/electron-main',
    //   electronPreload: 'src-electron/electron-preload'
    //   bexManifestFile: 'src-bex/manifest.json
    // },

    // https://v2.quasar.dev/quasar-cli-vite/developing-ssr/configuring-ssr
    ssr: {
      prodPort: 3000, // The default port that the production server should use
      // (gets superseded if process.env.PORT is specified at runtime)

      middlewares: [
        'logger',
        'gdriveProxy',
        'proxyMiddleware',
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

      // pwaExtendGenerateSWOptions (cfg) {},
      // pwaExtendInjectManifestOptions (cfg) {}
    },

    // https://v2.quasar.dev/quasar-cli-vite/developing-pwa/configuring-pwa
    pwa: {
      workboxMode: 'GenerateSW', // 'GenerateSW' or 'InjectManifest'
      // swFilename: 'sw.js',
      // manifestFilename: 'manifest.json',
      // extendManifestJson (json) {},
      // useCredentialsForManifestTag: true,
      // injectPwaMetaTags: false,
      // extendPWACustomSWConf (esbuildConf) {},
      // extendGenerateSWOptions (cfg) {},
      // extendInjectManifestOptions (cfg) {}
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-cordova-apps/configuring-cordova
    cordova: {
      // noIosLegacyBuildFlag: true, // uncomment only if you know what you are doing
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-capacitor-apps/configuring-capacitor
    capacitor: {
      hideSplashscreen: true,
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-electron-apps/configuring-electron
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

        appId: 'taskyon',
      },
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-browser-extensions/configuring-bex
    bex: {
      // extendBexScriptsConf (esbuildConf) {},
      // extendBexManifestJson (json) {},

      /**
       * The list of extra scripts (js/ts) not in your bex manifest that you want to
       * compile and use in your browser extension. Maybe dynamic use them?
       *
       * Each entry in the list should be a relative filename to /src-bex/
       *
       * @example [ 'my-script.ts', 'sub-folder/my-other-script.js' ]
       */
      extraScripts: [],
    },
  }
})
