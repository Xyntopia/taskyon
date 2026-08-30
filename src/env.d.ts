declare namespace NodeJS {
  interface ProcessEnv {
    COMMIT_HASH?: string
    NODE_ENV: string
    PUBLISH_DATE?: string
    VUE_ROUTER_MODE: 'hash' | 'history' | 'abstract' | undefined
    VUE_ROUTER_BASE: string | undefined
  }
}
