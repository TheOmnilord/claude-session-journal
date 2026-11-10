/** The journal this session writes to, while it is on. */
export type Journal = {
  /** Absolute path of the file being written now (a later part after a roll-over). */
  path: string
  /** The folder every journal of this project lives in. */
  dir: string
  /** The session id the journal was started for. */
  sessionId: string
  /** 1 for the first file, 2 for `<name>.part2.md`, ... */
  part: number
  /** Milliseconds since the epoch when the journal was turned on. */
  startedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-journal': { journal: Shaped<Journal | null> }
  }
}
