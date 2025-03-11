import { defineConfig } from 'vite'
import path from 'path'

const libPath = path.resolve(__dirname, './src/modules/client/tyClient.ts')
console.log('building', libPath)

export default defineConfig({
  build: {
    lib: {
      entry: libPath, // Adjust this to your actual library entry file
      name: 'tyclient',
      fileName: (format) => `tyclient.${format}.js`,
      formats: ['umd'], // UMD format for easy script inclusion
    },
    outDir: 'public/lib', // This ensures the output goes into public/
    emptyOutDir: true, // Cleans old files before build
    rollupOptions: {
      external: ['vue'], // externalize dependencies
      output: {
        format: 'umd', // Allows usage via script tag
        globals: { vue: 'Vue' },
      },
    },
  },
})
