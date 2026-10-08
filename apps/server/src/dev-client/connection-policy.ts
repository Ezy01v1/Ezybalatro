/** Pure decisions of the console client about connection failures (play.ts only does the I/O). */

/**
 * `connect_error`: exit when the very first connection fails (wrong URL, server down) or the
 * server rejects the token; once connected before, a failed attempt is just the server being
 * away (restart, shutdown) and socket.io keeps retrying.
 */
export function connectErrorAction(state: {
  everConnected: boolean;
  message: string;
}): 'exit' | 'retry' {
  if (!state.everConnected) return 'exit';
  return state.message === 'UNAUTHORIZED' ? 'exit' : 'retry';
}

/**
 * `disconnect`: socket.io reconnects by itself after a transport loss or ping timeout, but not
 * after `io server disconnect` (the server dropped us): then we must call `socket.connect()`.
 * A `leave`, a `q` or a replaced session never come back.
 */
export function disconnectAction(state: {
  reason: string;
  leaving: boolean;
  done: boolean;
}): 'none' | 'auto' | 'manual' {
  if (state.leaving || state.done || state.reason === 'io client disconnect') return 'none';
  return state.reason === 'io server disconnect' ? 'manual' : 'auto';
}
