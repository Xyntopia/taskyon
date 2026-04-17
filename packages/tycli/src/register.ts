import { register } from 'node:module'

register(new URL('./ts-loader.ts', import.meta.url), import.meta.url)
