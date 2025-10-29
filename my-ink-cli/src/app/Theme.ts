export const theme = {
  colors: {
    primary: 'cyan',
    accent: 'magenta',
    success: 'green',
    error: 'redBright',
    warning: 'yellow',
    muted: 'gray',
    foreground: 'white',
    background: 'black'
  },
  spacing(step = 1): number {
    return step;
  },
  focusPrefix: '▶',
  unfocusedPrefix: '•'
} as const;

export type Theme = typeof theme;
