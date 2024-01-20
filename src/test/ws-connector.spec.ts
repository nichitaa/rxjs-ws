import { TestScheduler } from 'rxjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forceReconnectMessage, STATUS, WebSocketConnector } from '../web-socket-connector';
import { EventWithMessage } from '../create-web-socket-observable';
import { delay, from, of, tap } from 'rxjs';
import { concatMap } from 'rxjs/internal/operators/concatMap';

const getMockWebsocketConnector = () => {
  const mockSocket = {
    onmessage: vi.fn((event) => {}),
    onopen: vi.fn((event) => {}),
    onclose: vi.fn((event) => {}),
    onerror: vi.fn((event) => {}),
    close: vi.fn((event) => {}),
    send(data: string) {
      this.onmessage({ data });
    },
  };
  const socket = mockSocket as unknown as WebSocket;
  const wsConnector = new WebSocketConnector({
    url: '',
    createWebSocketInstance: () => socket,
  });

  return { socket, wsConnector };
};

describe('[WebSocketConnector] rxjs marbles tests', () => {
  let testScheduler: TestScheduler;
  beforeEach(() => {
    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).deep.equal(expected);
    });
  });

  it.skip('example with expectObservable and delay', () => {
    const testStream$ = from([1, 2]).pipe(
      concatMap((x) => of(x).pipe(delay(1000))),
      tap((x) => console.log('[tap]: ', x)),
    );
    testScheduler.run(({ expectObservable }) => {
      const expectMarbles = '1s a 999ms (b|)';
      const expectedValues = {
        a: 1,
        b: 2,
      };
      expectObservable(testStream$).toBe(expectMarbles, expectedValues);
    });
  });

  it.skip('example with subscription marbles', () => {
    testScheduler.run(({ expectObservable, hot }) => {
      const source$ = hot('1s a 999ms b 99ms c 99ms |');
      const subscriptionMarbles = '1s ^ 1s !';
      const expectMarbles = '1s a 999ms b';

      expectObservable(source$, subscriptionMarbles).toBe(expectMarbles);
      expectObservable(source$, '1s ^ 5s ').toBe('1s a 999ms b 99ms c 99ms |');
    });
  });

  it('[WebSocketConnector] test status stream', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    testScheduler.run(({ expectObservable, cold }) => {
      const expectMarbles = 'a 2s b--c';
      const expectedValues = {
        a: STATUS.uninitialized,
        b: STATUS.connected,
        c: STATUS.disconnected,
      };

      const triggerMarbles = '- 1s a 999ms b--c';
      const triggerValues = {
        a: () => {
          wsConnector.connect();
        },
        b: () => {
          socket.onopen!({} as Event);
        },
        c: () => {
          socket.onclose!({ reason: 'test', code: 1 } as CloseEvent);
        },
      };

      expectObservable(wsConnector.status$).toBe(expectMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('[WebSocketConnector] disconnected stream status', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    testScheduler.run(({ expectObservable, cold }) => {
      const expectMarbles = 'a 2s b--c';
      const expectedValues = {
        a: STATUS.uninitialized,
        b: STATUS.connected,
        c: STATUS.disconnected,
      };

      const triggerMarbles = '- 1s a 999ms b--c';
      const triggerValues = {
        a: () => {
          wsConnector.connect();
        },
        b: () => {
          socket.onopen!({} as Event);
        },
        c: () => {
          socket.onerror!({ message: 'error' } as EventWithMessage);
        },
      };

      expectObservable(wsConnector.status$).toBe(expectMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('[WebSocketConnector] reconnecting stream status', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    testScheduler.run(({ expectObservable, cold }) => {
      const expectMarbles = 'a--b--c--b';
      const expectedValues = {
        a: STATUS.uninitialized,
        b: STATUS.connected,
        c: STATUS.reconnecting,
      };

      const triggerMarbles = '---a--b--c';
      const triggerValues = {
        a: () => {
          wsConnector.connect({ retryConfig: {} });
          socket.onopen!({} as Event);
        },
        b: () => {
          socket.onerror!({} as Event);
        },
        c: () => {
          socket.onopen!({} as Event);
        },
      };

      expectObservable(wsConnector.status$).toBe(expectMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('[WebSocketConnector] reconnecting error notification', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    testScheduler.run(({ expectObservable, cold }) => {
      const expectMarbles = '--a-b-#';
      const expectedValues = {
        a: { a: true },
        b: { b: true },
      };

      const triggerMarbles = 'a-b-c-d';
      const triggerValues = {
        a: () => {
          wsConnector.connect({ retryConfig: { count: 1 } });
          socket.onopen!({} as Event);
        },
        b: () => {
          socket.onmessage!({ data: JSON.stringify(expectedValues.a) } as MessageEvent);
        },
        c: () => {
          socket.onmessage!({ data: JSON.stringify(expectedValues.b) } as MessageEvent);
        },
        d: () => {
          socket.onerror!({} as Event); // fail the reconnect
          socket.onerror!({ message: '[some error]' } as EventWithMessage); // throw error
        },
      };

      expectObservable(wsConnector.messages()).toBe(
        expectMarbles,
        expectedValues,
        Error('WebSocket error [some error]'),
      );
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('[WebSocketConnector] disconnect socket connection', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const expectMarbles = 'a--b-c-b';
    const expectedValues = {
      a: STATUS.uninitialized,
      b: STATUS.connected,
      c: STATUS.disconnected,
    };

    const triggerMarbles = '---a-b-a';
    const triggerValues = {
      a: () => {
        wsConnector.connect({ retryConfig: {} });
        socket.onopen!({} as Event);
      },
      b: () => {
        wsConnector.disconnect();
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(wsConnector.status$).toBe(expectMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('[WebSocketConnector] send websocket events', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const expectMarbles = '--a--b';
    const expectedValues = {
      a: { a: true },
      b: { b: true, nested: { b: true } },
    };

    const triggerMarbles = 'a-b--c';
    const triggerValues = {
      a: () => {
        wsConnector.connect({ retryConfig: {} });
        socket.onopen!({} as Event);
      },
      b: () => {
        wsConnector.send(expectedValues.a);
      },
      c: () => {
        wsConnector.send(expectedValues.b);
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(wsConnector.messages()).toBe(expectMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('[WebSocketConnector] forceReconnect without retryConfig', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const expectStatusMarbles = 'a-b-c';
    const expectedStatusValues = {
      a: STATUS.uninitialized,
      b: STATUS.connected,
      c: STATUS.disconnected,
    };

    const expectMessagesMarbles = '----#';
    const triggerMarbles = '--a-b';
    const triggerValues = {
      a: () => {
        wsConnector.connect();
        socket.onopen!({} as Event);
      },
      b: () => {
        wsConnector.forceReconnect();
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(wsConnector.messages()).toBe(
        expectMessagesMarbles,
        {},
        Error(forceReconnectMessage),
      );
      expectObservable(wsConnector.status$).toBe(expectStatusMarbles, expectedStatusValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('[WebSocketConnector] forceReconnect with retryConfig', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const expectStatusMarbles = 'a-b-c-b';
    const expectedStatusValues = {
      a: STATUS.uninitialized,
      b: STATUS.connected,
      c: STATUS.reconnecting,
    };

    const triggerMarbles = '--a-b-c';
    const triggerValues = {
      a: () => {
        wsConnector.connect({ retryConfig: {} });
        socket.onopen!({} as Event);
      },
      b: () => {
        wsConnector.forceReconnect();
      },
      c: () => {
        socket.onopen!({} as Event);
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(wsConnector.messages()).toBe('-'); // always active
      expectObservable(wsConnector.status$).toBe(expectStatusMarbles, expectedStatusValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });
});
