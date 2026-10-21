export type NativeWebSearchProfile = {
  provider: string
  nativeWebSearch?: boolean | undefined
}

const defaultProviderNativeWebSearch = (provider: string) =>
  provider === 'openai' ||
  provider === 'chatgpt-codex' ||
  provider === 'taskyon' ||
  provider === 'openrouter.ai'

export const resolveNativeWebSearchSupport = (profile: NativeWebSearchProfile) =>
  profile.nativeWebSearch ?? defaultProviderNativeWebSearch(profile.provider)
