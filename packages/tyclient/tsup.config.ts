// tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    tyclient: 'src/index.ts', // 👈 will output dist/tyclient.es.js, dist/tyclient.cjs.js, dist/tyclient.d.ts
  },
  format: ['esm', 'cjs'], // you can drop formats you don’t need
  dts: true, // ✅ generates declaration files
  sourcemap: true,
  clean: true, // wipe dist/ before build
  minify: false, // let consumers minify
  target: 'esnext',
  external: [
    /*'vue', // keep peer deps external
    'zod',
    'openai',
    'type-fest',*/
  ],
  tsconfig: 'tsconfig.dts.json',
  // optional tweaks
  treeshake: true,
  splitting: false, // good for libraries
})
