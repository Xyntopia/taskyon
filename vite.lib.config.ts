import { defineConfig } from 'vite'
import path from 'path'
import esbuild from 'esbuild'

const libPath = path.resolve(__dirname, './src/modules/client/tyClient.ts')
console.log('building', libPath)

export default defineConfig({
  build: {
    minify: false,
    copyPublicDir: false,
    lib: {
      entry: libPath, // Adjust this to your actual library entry file
      name: 'tyclient',
      //formats: ['cjs', 'es', 'umd'], // we only need this, if we don't have multiple output in rollupOptions
      fileName: (format) => `tyclient.${format}.js`,
    },
    outDir: 'public/lib', // This ensures the output goes into public/
    emptyOutDir: true, // Cleans old files before build
    rollupOptions: {
      external: ['vue'], // externalize dependencies
      output: [
        {
          format: 'umd',
          entryFileNames: 'tyclient.umd.js', // Non-minified version
          globals: { vue: 'Vue' },
          name: 'TyClient', // Global variable name for minified
        },
        {
          format: 'umd',
          entryFileNames: 'tyclient.umd.min.js', // Minified version
          globals: { vue: 'Vue' },
          name: 'TyClient', // Global variable name for minified
          plugins: [
            {
              name: 'minify',
              renderChunk(code) {
                return esbuild.transform(code, { minify: true }).then((result) => result.code)
              },
            },
          ],
        },
      ],
    },
  },
})
