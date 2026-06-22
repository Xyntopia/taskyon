declare module 'terminal-kit' {
  export type Terminal = {
    width: number
    height: number
    moveTo: (x: number, y: number) => void
    eraseLine: () => void
    inverse: (text: string) => void
    styleReset: () => void
  }

  const terminalKit: {
    terminal: Terminal
  }

  export default terminalKit
}
