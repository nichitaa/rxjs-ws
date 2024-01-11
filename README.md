# rxjs-ws

If you're using RxJS and WebSockets, you can consider using **`rxjs-ws`** for managing the socket connections, incoming
and out-coming messages.

WebSocket library to simply integrate with RxJS.

#### Inspired by https://github.com/insidewhy/rxjs-websockets

## Installation

```bash
npm install @nichitaa/rxjs-ws
```

## Usage

```typescript
// create WS connector instance
const conn = new WebSocketConnector({
  url: '...',
});

// connect on demand
conn.connect({
  // retry configuration for ws unexpected errors
  retryConfig: {
    delay: 1000,
    count: 10,
    // success callback after retry was finished successfully and new socket connection was established
    onSuccess: () => {
      console.log('successfully reconnected');
    },
  },
});

// send the request
conn.send<{ payload: string; streamId: number }>({ payload: '...', streamId: 1 });

// for convenience, you can create a stream that will filter only the ws messages you're interested in
// usually filtered by requested method/stream id etc.
// you could also apply any rxjs operators to for example accumulate the events
const firstStream$ = conn
  .messages<{ streamId: number; data: string }>()
  .pipe(filter((event) => event.streamId === 1));

// listen to incoming messages
firstStream$.subscribe((event) => {
  console.log('first stream events: ', event);
});

// reconnect the WS connection manually
conn.forceReconnect();

// force disconnect
conn.disconnect();

// subscribe and react to socket status changes
conn.status$.subscribe((socketStatus) => {
  if (socketStatus === STATUS.uninitialized) {}
  if (socketStatus === STATUS.connected) {}
  if (socketStatus === STATUS.reconnecting) {}
  if (socketStatus === STATUS.disconnected) {}
});

```

The `WebSocketConnector` constructor accepts custom serializer (out-coming) and deserializer (incoming) that defaults
to `JSON` functions, in
combination with WebSocket properties:

```typescript
url: string | URL;
protocols?: string | string[];
createWebSocketInstance?: typeof defaultCreateWebSocket;
```
