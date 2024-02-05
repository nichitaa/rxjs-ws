import { beforeEach, describe, expect, it } from 'vitest';
import { TestScheduler } from 'rxjs/testing';
import { getMockWebsocketConnector } from './get-mock-websocket.connector';
import { STREAM_STATUS } from '../core/constants';
import { delay, filter, identity, scan, tap } from 'rxjs';

interface TestEvent {
  from: string;
}

describe('[getStreamHandler] rxjs marbles tests', () => {
  let testScheduler: TestScheduler;
  beforeEach(() => {
    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toStrictEqual(expected);
    });
  });

  it('starts in uninitialized state with default response', () => {
    const { wsConnector } = getMockWebsocketConnector();
    const defaultResponse = ['default'];
    const handler = wsConnector.getStreamHandler({
      default: defaultResponse,
    });

    const expectedMarbles = 'a';
    const expectedValues = {
      a: {
        status: STREAM_STATUS.uninitialized,
        response: defaultResponse,
      },
    };

    testScheduler.run(({ expectObservable }) => {
      expectObservable(handler.$).toBe(expectedMarbles, expectedValues);
    });
  });

  it('triggers send request', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();
    const handler = wsConnector.getStreamHandler();

    const expectedMarbles = 'a--b--c';
    const expectedValues = {
      a: {
        status: STREAM_STATUS.uninitialized,
        response: undefined,
      },
      b: {
        status: STREAM_STATUS.loading,
        request: { b: true },
        response: undefined,
        error: undefined,
      },
      c: {
        status: STREAM_STATUS.ready,
        request: { b: true },
        response: { from: 'c' },
        error: undefined,
      },
    };

    const triggerMarbles = 'a--b--c';
    const triggerValues = {
      a: () => {
        wsConnector.connect();
        socket.onopen!({} as Event);
      },
      b: () => {
        handler.send({
          request: { b: true },
          transformResponse: identity,
        });
      },
      c: () => {
        socket.send(JSON.stringify({ from: 'c' }));
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(handler.$).toBe(expectedMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('applies transformResponse operator', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const handler = wsConnector.getStreamHandler<TestEvent, TestEvent[], TestEvent, unknown>();
    const expectedMarbles = '(ab)-c--d';
    const expectedValues = {
      a: {
        status: STREAM_STATUS.uninitialized,
        response: undefined,
      },
      b: {
        status: STREAM_STATUS.loading,
        request: { from: 'a' },
        response: undefined,
        error: undefined,
      },
      c: {
        status: STREAM_STATUS.ready,
        request: { from: 'a' },
        response: [{ from: 'b' }],
        error: undefined,
      },
      d: {
        status: STREAM_STATUS.ready,
        request: { from: 'a' },
        response: [{ from: 'b' }, { from: 'b' }],
        error: undefined,
      },
    };

    const triggerMarbles = 'a----b--b';
    const triggerValues = {
      a: () => {
        wsConnector.connect();
        socket.onopen!({} as Event);
        handler.send({
          request: { from: 'a' },
          transformResponse: (source$) => {
            // filter only 'b' and accumulate them
            return source$.pipe(
              filter((x) => x.from === 'b'),
              scan((acc, current) => {
                // create new array instead of pushing, otherwise array will be mutated and test will fail
                return [...acc, current];
              }, [] as TestEvent[]),
            );
          },
        });
      },
      b: () => {
        socket.send(JSON.stringify({ from: 'c' }));
        socket.send(JSON.stringify({ from: 'd' }));
        socket.send(JSON.stringify({ from: 'b' }));
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(handler.$).toBe(expectedMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('process next request after current completed', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const handler = wsConnector.getStreamHandler<TestEvent, TestEvent, TestEvent, unknown>();
    const expectedMarbles = '(ab) 7ms c-(de)';
    const expectedValues = {
      a: {
        status: STREAM_STATUS.uninitialized,
        response: undefined,
      },
      b: {
        status: STREAM_STATUS.loading,
        request: { from: 'a' },
        response: undefined,
        error: undefined,
      },
      c: {
        status: STREAM_STATUS.ready,
        request: { from: 'a' },
        response: { from: 'b' },
        error: undefined,
      },
      d: {
        status: STREAM_STATUS.ready,
        request: { from: 'a' },
        response: { from: 'd' },
        error: undefined,
      },
      e: {
        status: STREAM_STATUS.loading,
        request: { from: 'c' },
        response: undefined,
        error: undefined,
      },
    };

    const triggerMarbles = 'abcd';
    const triggerValues = {
      a: () => {
        wsConnector.connect();
        socket.onopen!({} as Event);
        handler.send({
          request: { from: 'a' },
          transformResponse: (source$) => {
            return source$.pipe(delay(10));
          },
        });
      },
      b: () => {
        socket.send(JSON.stringify({ from: 'b' }));
      },
      c: () => {
        handler.send({
          request: { from: 'c' },
          transformResponse: identity,
        });
      },
      d: () => {
        socket.send(JSON.stringify({ from: 'd' }));
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(handler.$).toBe(expectedMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('takes until websocket status is not disconnected', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const closeEvent = new CloseEvent('Close Event', {
      code: 1,
      reason: 'some reason',
      wasClean: true,
    });

    const handler = wsConnector.getStreamHandler<TestEvent, TestEvent, TestEvent, unknown>();
    const expectedMarbles = '(ab)(ccc)(de)';
    const expectedValues = {
      a: {
        status: STREAM_STATUS.uninitialized,
        response: undefined,
      },
      b: {
        status: STREAM_STATUS.loading,
        request: { from: 'a' },
        response: undefined,
        error: undefined,
      },
      c: {
        status: STREAM_STATUS.ready,
        request: { from: 'a' },
        response: { from: 'b' },
        error: undefined,
      },
      d: {
        status: STREAM_STATUS.uninitialized,
        response: undefined,
      },
      e: {
        status: STREAM_STATUS.ready,
        response: undefined,
        error: closeEvent,
      },
    };

    const triggerMarbles = 'a 3ms b 4ms c';
    const triggerValues = {
      a: () => {
        wsConnector.connect();
        socket.onopen!({} as Event);
        handler.send({
          request: { from: 'a' },
          transformResponse: identity,
        });
      },
      b: () => {
        socket.send(JSON.stringify({ from: 'b' }));
        socket.send(JSON.stringify({ from: 'b' }));
        socket.send(JSON.stringify({ from: 'b' }));
      },
      c: () => {
        socket.onclose!(closeEvent);
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(handler.$).toBe(expectedMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('sends messages in order after delayed connection', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const handler = wsConnector.getStreamHandler<TestEvent, TestEvent, TestEvent, unknown>();
    const expectedMarbles = 'a 2s b-(cd)-(ef)-g';
    const expectedValues = {
      a: {
        status: STREAM_STATUS.uninitialized,
        response: undefined,
      },
      b: {
        status: STREAM_STATUS.loading,
        request: { from: 'a' },
        response: undefined,
        error: undefined,
      },
      c: {
        status: STREAM_STATUS.ready,
        request: { from: 'a' },
        response: { from: 'c' },
        error: undefined,
      },
      d: {
        status: STREAM_STATUS.loading,
        request: { from: 'b' },
        response: undefined,
        error: undefined,
      },
      e: {
        status: STREAM_STATUS.ready,
        request: { from: 'b' },
        response: { from: 'd' },
        error: undefined,
      },
      f: {
        status: STREAM_STATUS.loading,
        request: { from: 'c' },
        response: undefined,
        error: undefined,
      },
      g: {
        status: STREAM_STATUS.ready,
        request: { from: 'c' },
        response: { from: 'e' },
        error: undefined,
      },
    };

    const triggerMarbles = 'a 2s b-c 4ms d 4ms e';
    const triggerValues = {
      a: () => {
        handler.send({
          request: { from: 'a' },
          transformResponse: identity,
        });
        handler.send({
          request: { from: 'b' },
          transformResponse: identity,
        });
        handler.send({
          request: { from: 'c' },
          transformResponse: identity,
        });
      },
      b: () => {
        wsConnector.connect();
        socket.onopen!({} as Event);
      },
      c: () => {
        socket.send(JSON.stringify({ from: 'c' }));
      },
      d: () => {
        socket.send(JSON.stringify({ from: 'd' }));
      },
      e: () => {
        socket.send(JSON.stringify({ from: 'e' }));
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(handler.$).toBe(expectedMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });
  });

  it('sends all request when `awaitReadyStatusBeforeNextRequest: false` and does not wait for ready status', () => {
    const { wsConnector, socket } = getMockWebsocketConnector();

    const handler = wsConnector.getStreamHandler<TestEvent, TestEvent, TestEvent, unknown>({
      awaitReadyStatusBeforeNextRequest: false,
    });
    const expectedMarbles = '(ab)(cde)';
    const expectedValues = {
      a: {
        status: STREAM_STATUS.uninitialized,
        response: undefined,
      },
      b: {
        status: STREAM_STATUS.loading,
        request: { from: 'a' },
        response: undefined,
        error: undefined,
      },
      c: {
        status: STREAM_STATUS.ready,
        request: { from: 'a' },
        response: { from: 'b' },
        error: undefined,
      },
      d: {
        status: STREAM_STATUS.loading,
        request: { from: 'b1' },
        response: undefined,
        error: undefined,
      },
      e: {
        status: STREAM_STATUS.loading,
        request: { from: 'b2' },
        response: undefined,
        error: undefined,
      },
    };

    const triggerMarbles = 'a 3ms b';
    const triggerValues = {
      a: () => {
        wsConnector.connect();
        socket.onopen!({} as Event);
        handler.send({
          request: { from: 'a' },
          transformResponse: identity,
        });
      },
      b: () => {
        handler.send({
          request: { from: 'b1' },
          transformResponse: identity,
        });
        socket.send(JSON.stringify({ from: 'b' }));
        handler.send({
          request: { from: 'b2' },
          transformResponse: identity,
        });
      },
    };

    testScheduler.run(({ expectObservable, cold }) => {
      expectObservable(handler.$).toBe(expectedMarbles, expectedValues);
      expectObservable(cold(triggerMarbles, triggerValues).pipe(tap((fn) => fn())));
    });

    /* eslint-disable @typescript-eslint/unbound-method */
    expect(socket.send).toHaveBeenNthCalledWith(1, JSON.stringify({ from: 'a' }));
    expect(socket.send).toHaveBeenNthCalledWith(2, JSON.stringify({ from: 'b' }));
    expect(socket.send).toHaveBeenNthCalledWith(3, JSON.stringify({ from: 'b1' }));
    expect(socket.send).toHaveBeenNthCalledWith(4, JSON.stringify({ from: 'b2' }));
    /* eslint-enable @typescript-eslint/unbound-method */
  });
});
