# rxjs-ws

WebSocket library to simply integrate with RxJS.

> Inspired by: [rxjs-websockets](https://github.com/insidewhy/rxjs-websockets). It is an extension of it, that covers most of WebSocket manipulation and provides flexible utilities/streams to work with WebSocket events.

### Features 🎯

- Manage WebSocket connection / provides real time connection status
- Manage reconnection / retries (via rxjs operators) / easy API to conditionally reconnect
- Custom serialization / deserialization
- ✨ `getStreamHandler` - Powerful utility to create stream handlers from WebSocket events


For example on application side you have WS events `events/posts` & `events/users`. You can create handlers for each of them, for example:
```ts
const postsHandler = handler.getStreamHandler<PostEvent, Post, PostRequest, PostError>({ default: [] })
const usersHandler = handler.getStreamHandler<UserEvent, User, UserRequest, UserError>({ default: undefined, awaitReadyStatusBeforeNextRequest: false })
```

### Getting Started 🎉
#### Peer Dependencies 

* `rxjs`: `^7.x`,

### Installation

```bash
npm install @nichitaa/rxjs-ws
```

### Create `WebSocketConnector`

```ts
const connector = new WebSocketConnector({
  url: 'wss://...',
});
```

Default WebSocket instance is `window.WebSocket` 

Params:
- `url`, `protocols` - [MDN docs](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- `createWebSocketInstance` - create custom WebSocket instance (for example socket.io)
- `serializer` - provide custom serializer function (defaults to `JSON.stringify`)
- `deserializer` - provide custom deserializer function (defaults to `JSON.parse`)

### Manage WebSocket connection

With optionally `retryConfig`
```ts
connector.connect({ 
  retryConfig: { 
    count: 10, 
    delay: of(true).pipe(delay(1000)),
    onSuccess: () => {
      console.log('successfully retried websocket connection')
    }
  } 
});
```

Params:
- `count`, `delay` - [RxJS `RetryConfig` docs](https://rxjs.dev/api/index/interface/RetryConfig)
- `onSuccess` - callback called when retry was successfully

Disconnect.

```ts
connector.disconnect();
```

Force trigger reconnection, might be usefully on stale connections.

```ts
connector.forceReconnect("optional custom message");
// OR
connector.forceReconnect();
```

Subscribe to status changes.

```ts
import { CONN_STATUS } from '@nichitaa/rxjs-ws';

connector.status$.subscribe((status) => {
  if (CONN_STATUS.connected) {
    console.log('just connected')
  }
})
```

`status$` is stream with possible values (`CONN_STATUS`)

- `uninitialized` - connection not yet initialized
- `connected` - connection successfully established
- `reconnecting` - reconnection is in progress
- `disconnected` - dropped socket connection (not active)

Send events (aka requests).

```ts
type Request = {
  payload: string;
  streamId: number
}

conn.send<Request>({ payload: '...', streamId: 1 });
```

Receive incoming messages.

```ts
// create a custom stream that filteres events for a specific method
const users$ = connector
  .messages<{ method: string; data: string }>()
  .pipe(filter((event) => event.method === 'v1/users/events'));

// subscribe to users events
users$.subscribe((event) => {
  console.log('users just received: ', event);
});
```


✨ Utility to create streams - `getStreamHandler`

```ts
// create a custom stream that filteres events for a specific method
import { STREAM_STATUS } from '@nichitaa/rxjs-ws';

const usersHandler = connector.getStreamHandler<WSEvent, User, UserRequest, UserError>({
  default: [],
})

const scanUsers = (source$) => {
  return source$.pipe(
    // filter only users types of events
    filter(event => event.method === 'v1.users'),
    // throw error if so that handler can catch it
    tap((event) => {
      if (isError(event)) throw x
    }),
    // for example accumulate them
    scan(
      (acc, event) => {
        if (event.isLastMessage) acc.snapshotEnd = true;
        acc.events.push(event.user);
        return acc;
      },
      { snapshotEnd: false, events: [] },
    ),
    filter((x) => x.snapshotEnd),
    map((x) => x.events),
  );
};

// send a request
usersHandler.send({
  request: { method: 'v1.users' },
  transformResponse: scanUsers,
});

usersHandler.$.subscribe(({ response, request, status, error }) => {
  // react to stream emissions
  
  if (status === STREAM_STATUS.loading) {
    // loading
  }
  if (status === STREAM_STATUS.ready && error === undefined) {
    const userNames = response.map(x => x.username);
  }
  if (status === STREAM_STATUS.ready && error !== undefined) {
    console.error(error);
  }
})
```

Arguments of the `getStreamHandler` function:

- `default` - default `response` (defaults to `undefined`)
- `transformRequests` - custom RxJS operator that can change the requests that are processed/send to WebSocket (defaults to [`identity`](https://rxjs.dev/api/index/function/identity))
- `resetResponseOnNextRequest` - reset `response` back to `default` for the next request (`handler.send({request: {...}})`) (defaults to `true`)
- `resetErrorOnNextRequest` - similar to `resetResponseOnNextRequest`, but resets `error` field (defaults to `true`)
- `awaitReadyStatusBeforeNextRequest` - allows to process next request without waiting for at least one `ready` status emission from current processed request

Because `handler.send()` can be called in any order at any time, it is important to process them sequentially, `awaitReadyStatusBeforeNextRequest` allows to 
drop the execution (waiting for response) for current request and continue with execution of the new request, for example:

- with `awaitReadyStatusBeforeNextRequest: false`:
  - ```ts
    const handler = connector.getStreamHandler({
      awaitReadyStatusBeforeNextRequest: false
    })
    handler.send({request: 1});
    handler.send({request: 2});
    handler.send({request: 3});
    ```
    In the above example `handler.$` will emit:
    1. `{status: 'uninitialized', response: undefined}`
    2. `{status: 'loading', request: 1, response: undefined}`
    3. `{status: 'loading', request: 2, response: undefined}`
    4. `{status: 'loading', request: 3, response: undefined}`
    5. `{status: 'ready', request: 3, response: undefined}` When response for 3rd request will arrive, and all previous request will be correctly send

- with `awaitReadyStatusBeforeNextRequest: true`:
  - ```ts
    const handler = connector.getStreamHandler({})
    handler.send({request: 1});
    handler.send({request: 2});
    ```
  In the above example `handler.$` will emit:
    1. `{status: 'uninitialized', response: undefined}`
    2. `{status: 'loading', request: 1, response: undefined}`
    3. `{status: 'ready', request: 1, response: ... }`
    4. `{status: 'loading', request: 2, response: undefined}`
    5. `{status: 'ready', request: 2, response: ...}` All requests are send in order and each next request is started only after current has at least one emission with status `ready`
    