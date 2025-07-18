// Configuration for your app
// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file

import { defineConfig } from '#q-app/wrappers'
import { fileURLToPath } from 'node:url'
import type { NormalizedOutputOptions, OutputBundle } from 'rollup'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { analyzer } from 'vite-bundle-analyzer'

function getGitCommitHash() {
  try {
    // Try to fetch commit hash locally
    // we need to expicitly specify 8 chars, because git default behaves differently on different OS.
    const commitHash = execSync('git rev-parse --short=8 HEAD').toString().trim()
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

// Function to copy multiple files
function copyFiles(fileList: { src: string; dest: string }[]) {
  fileList.forEach((file) => {
    const srcPath = path.resolve(__dirname, file.src)
    const destPath = path.resolve(__dirname, file.dest)

    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath)
      console.log(`Copied ${file.src} to ${file.dest}`)
    } else {
      console.error(`${file.src} not found`)
    }
  })
}

const filesToCopy = [
  {
    src: 'src/assets/taskyon_settings.json',
    dest: 'public/taskyon_settings.json',
  },
  {
    src: 'README.md',
    dest: 'public/docs/README.md',
  },
]

// Custom plugin to adjust sourcemaps and add banner comment
function sourcemapBannerPlugin() {
  return {
    name: 'sourcemap-banner-plugin',
    generateBundle(_options: NormalizedOutputOptions, bundle: OutputBundle) {
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
}

export default defineConfig((ctx) => {
  if (ctx.prod) {
    copyFiles(filesToCopy)
  }

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
        strict: true, // (recommended) enables strict settings for TypeScript
        vueShim: true, // required when using ESLint with type-checked rules, will generate a shim file for `*.vue` files
        extendTsConfig(/*tsConfig*/) {
          // You can use this hook to extend tsConfig dynamically
          // For basic use cases, you can still update the usual tsconfig.json file to override some settings
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

      /**
       * Set to `false` to disable minification, or specify the minifier to use.
       * Available options are 'terser' or 'esbuild'.
       * If set to anything but boolean false then it also applies to CSS.
       * For production only.
       * @default 'esbuild'
       */
      minify: 'terser',

      /**
       * Minification options for html-minifier-terser.
       *
       * @see https://github.com/terser/html-minifier-terser?tab=readme-ov-file#options-quick-reference for complete list of options
       *
       * @default
       *  {
       *    removeComments: true,
       *    collapseWhitespace: true,
       *    removeAttributeQuotes: true,
       *    collapseBooleanAttributes: true,
       *    removeScriptTypeAttributes: true
       *  }
       */
      htmlMinifyOptions: {
        //TODO: remove console.log!
        removeComments: true,
        collapseWhitespace: true,
        removeAttributeQuotes: true,
        collapseBooleanAttributes: true,
        removeScriptTypeAttributes: true,
      },

      // not sure, if we need this here...
      sourcemap: process.env.SOURCEMAP === 'true',

      env: {
        PUBLISH_DATE: new Date().toISOString(),
        COMMIT_HASH: commitHash,
      },
      // rawDefine: {}
      // ignorePublicFolder: true,
      // minify: false,
      // polyfillModulePreload: true,
      // distDir

      // extendViteConf (viteConf) {},
      extendViteConf(viteConf) {
        // *******  get rid of console.log in prod mode ****
        // Add this for dropping console and debugger in production:
        viteConf.esbuild = viteConf.esbuild || {}
        // TODO: https://github.com/evanw/esbuild/issues/3656  only drop console.log/info
        viteConf.esbuild.drop = droplogging ? ['console', 'debugger'] : []

        // ********   configure pglite ********/
        // https://pglite.dev/docs/bundler-support
        // Extend the Vite configuration to exclude dependencies from optimization
        viteConf.optimizeDeps = {
          ...viteConf.optimizeDeps,
          exclude: ['@electric-sql/pglite'], // replace 'some-library' with the module you want to exclude
        }

        // Optional: Exclude from Rollup build as well
        viteConf.build = {
          ...viteConf.build,
          rollupOptions: {
            ...viteConf.build?.rollupOptions,
            external: ['@electric-sql/pglite'], // ensure that Rollup does not bundle this module
          },
        }
        //*****   end of pglite configuration  */

        // ****   make our old taskyon workers "work" in vite
        // TODO: check if w need this extendedConf
        // we might be able to get rid of it...
        viteConf.worker = viteConf.worker || {}

        // we have to do the next thing, to ensure, we don't get this error:
        // [vite:worker-import-meta-url] Invalid value "iife" for option "worker.format" - UMD and IIFE output formats are not supported for code-splitting builds.
        // check https://github.com/vitejs/vite/issues/18585 for more infos
        viteConf.worker.format = 'es' // Ensure workers use ES module format
        //*******    end of worker config */

        // we are doing the following, because we always get this error here whe building our app:
        // x Build failed in 4.18s
        // [vite:build-import-analysis] [plugin vite:build-import-analysis] public/docs/DEVELOPMENT.md (29:182): Failed to parse source for import analysis because the content contains invalid JS syntax. You may need to install appropriate plugins to handle the .md file format, or if it's an asset, add "**/*.md" to `assetsInclude` in your configuration.
        // file: /home/tom/git/taskyon/frontend/public/docs/DEVELOPMENT.md:29:182
        viteConf.assetsInclude = viteConf.assetsInclude || []
        // Treat Markdown files as static assets
        if (Array.isArray(viteConf.assetsInclude)) {
          viteConf.assetsInclude.push('**/*.md')
        } else {
          viteConf.assetsInclude = [viteConf.assetsInclude, '**/*.md']
        }
      },
      // viteVuePluginOptions: {},

      vitePlugins: [
        // Only apply this plugin in production when sourcemaps are enabled
        ...(ctx.prod ? [sourcemapBannerPlugin()] : []),

        // https://www.npmjs.com/package/vite-bundle-analyzer
        analyzer({
          openAnalyzer: true, // Automatically open the analyzer UI in your browser
          summary: true, // Set to true if you prefer just a summary
          fileName: '../analyze_report',
          analyzerMode: 'static', // we use static here so that it also works in a CI setting.
          // Other options can go here if needed.
        }),
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
              lintCommand: 'eslint -c ./eslint.config.js "./src*/**/*.{ts,js,mjs,cjs,vue}"',
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
        'taskHttpApi',
        'gdriveProxy',
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
