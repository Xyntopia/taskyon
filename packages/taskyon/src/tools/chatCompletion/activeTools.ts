export const limitActiveTools = (tools: string[], maxActiveTools?: number): string[] =>
  maxActiveTools !== undefined && tools.length > maxActiveTools
    ? tools.slice(0, maxActiveTools)
    : tools
