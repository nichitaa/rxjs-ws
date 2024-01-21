import { TestScheduler } from 'rxjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectConfig,
  DeserializeFn,
  forceReconnectMessage,
  SerializeFn,
  STATUS,
  WebSocketConnector,
  WebSocketConnectorConfig,
} from '../web-socket-connector';
import { EventWithMessage } from '../create-web-socket-observable';
import { delay, from, of, tap } from 'rxjs';
import { concatMap } from 'rxjs/internal/operators/concatMap';

const getMockWebsocketConnector = (params?: Partial<WebSocketConnectorConfig>) => {
  const mockSocket = {
    onmessage: vi.fn(),
    onopen: vi.fn(),
    onclose: vi.fn(),
    onerror: vi.fn(),
    close: vi.fn(),
    send: vi.fn((data: string) => {
      mockSocket.onmessage({ data });
    }),
  };
  const socket = mockSocket as unknown as WebSocket;
  const wsConnector = new WebSocketConnector({
    url: '',
    createWebSocketInstance: () => socket,
    ...params,
  });

  return { socket, wsConnector };
};

describe('[WebSocketConnector] rxjs marbles tests', () => {
  let testScheduler: TestScheduler;
  beforeEach(() => {
    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toStrictEqual(expected);
    });
  });

  it.skip('[example] with expectObservable and delay', () => {
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

  it.skip('[example] with subscription marbles', () => {
    testScheduler.run(({ expectObservable, hot }) => {
      const source$ = hot('1s a 999ms b 99ms c 99ms |');
      const subscriptionMarbles = '1s ^ 1s !';
      const expectMarbles = '1s a 999ms b';

      expectObservable(source$, subscriptionMarbles).toBe(expectMarbles);
      expectObservable(source$, '1s ^ 5s ').toBe('1s a 999ms b 99ms c 99ms |');
    });
  });

  it('should emit correct stream statuses (uninitialized, connected, disconnected)', () => {
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

  it('should emit disconnected stream status on socket error', () => {
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

  it('it should emit reconnecting stream status', () => {
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

  it('should try to reconnect and emit error notification in case of failure', () => {
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

  it('should manually disconnect from socket', () => {
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

  it('should send websocket events/requests', () => {
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

  it('should emit error when calling forceReconnect without retryConfig', () => {
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

  it('should try to reconnect when calling forceReconnect with retryConfig', () => {
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

  it('should call `retryConfig.onSuccess()` method after successful reconnecting', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const retryConfig: ConnectConfig['retryConfig'] = {
      onSuccess: vi.fn(),
      count: 1,
    };

    const triggerValues = {
      a: () => {
        wsConnector.connect({ retryConfig });
        socket.onopen!({} as Event);
        socket.onerror!({ message: 'error' } as EventWithMessage);
        socket.onopen!({} as Event);
        expect(retryConfig.onSuccess).toHaveBeenCalledOnce();
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(wsConnector.messages()).toBe('-'); // always active
      expectObservable(cold('a', triggerValues).pipe(tap((fn) => fn()))).toBe('a', triggerValues);
    });
  });

  it('should apply custom serialization and deserialization', () => {
    // mock implementations of serialization/deserialization - concatenates a string to the passed argument, to distinguish between them
    const mockSerializer: SerializeFn<unknown> = vi.fn((request) => {
      if (typeof request !== 'string') throw new Error();
      return `serialized_${request}`;
    });

    const mockDeserializer: DeserializeFn<unknown> = vi.fn((response) => {
      if (typeof response !== 'string') throw new Error();
      return `deserialized_${response}`;
    });

    const { wsConnector, socket } = getMockWebsocketConnector({
      serializer: mockSerializer,
      deserializer: mockDeserializer,
    });

    const request1 = JSON.stringify('send-request-1');
    const request2 = JSON.stringify('send-request-2');

    const triggerMarbles = 'ab';
    const triggerValues = {
      a: () => {
        wsConnector.connect();
        socket.onopen!({} as Event);
      },
      b: () => {
        wsConnector.send(request1);
        expect(mockSerializer).toHaveBeenCalledOnce();
        expect(mockSerializer).toHaveBeenCalledWith(request1);
        expect(mockDeserializer).toHaveBeenCalledOnce();
        expect(mockDeserializer).toHaveBeenCalledWith('serialized_' + request1);
        wsConnector.send(request2);
        expect(mockSerializer).toHaveBeenCalledTimes(2);
        expect(mockDeserializer).toHaveBeenCalledTimes(2);
      },
    };

    const expectedMarbles = '-(ab)';
    const expectedValues = {
      a: 'deserialized_serialized_' + request1,
      b: 'deserialized_serialized_' + request2,
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(wsConnector.messages()).toBe(expectedMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn()))).toBe(
        triggerMarbles,
        triggerValues,
      );
    });
  });

  it('should send websocket messages/requests after delayed connection', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const request1 = 'send-request-1';
    const request2 = 'send-request-2';

    const triggerMarbles = 'a 1s b';
    const triggerValues = {
      a: () => {
        wsConnector.send(request1);
        wsConnector.send(request2);
      },
      b: () => {
        wsConnector.connect();
        socket.onopen!({} as Event);

        /* eslint-disable @typescript-eslint/unbound-method */
        expect(socket.send).toHaveBeenCalledTimes(2);
        expect(socket.send).toHaveBeenNthCalledWith(1, JSON.stringify(request1));
        expect(socket.send).toHaveBeenNthCalledWith(2, JSON.stringify(request2));
        /* eslint-enable @typescript-eslint/unbound-method */
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(wsConnector.messages()).toBe('-'); // active without emissions
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn()))).toBe(
        triggerMarbles,
        triggerValues,
      );
    });
  });
});
