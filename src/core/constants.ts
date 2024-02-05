export const CONNECTION_STATUS = {
  uninitialized: 'uninitialized',
  connected: 'connected',
  reconnecting: 'reconnecting',
  disconnected: 'disconnected',
} as const;

export const FORCE_RECONNECT_MESSAGE = 'force reconnect' as const;

export const STREAM_STATUS = {
  uninitialized: 'uninitialized',
  ready: 'ready',
  loading: 'loading',
} as const;
