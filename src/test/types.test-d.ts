import { describe, it, expectTypeOf } from 'vitest';
import { getMockWebsocketConnector } from './get-mock-websocket.connector';
import { SendRequestParams, StreamResponse } from '../core/types';
import { BehaviorSubject } from 'rxjs';

describe('[types]', () => {
  it('[getStreamHandler]', () => {
    const { wsConnector } = getMockWebsocketConnector();

    interface WsEvent {
      id: number;
      data: string;
    }

    interface Request {
      from: string;
      timestamp: number;
    }

    const handler = wsConnector.getStreamHandler<WsEvent, WsEvent, Request>();

    /* eslint-disable @typescript-eslint/unbound-method */
    expectTypeOf(handler.send)
      .parameter(0)
      .toMatchTypeOf<SendRequestParams<WsEvent, WsEvent, Request>>();

    expectTypeOf(handler.$).toMatchTypeOf<
      BehaviorSubject<StreamResponse<WsEvent, Request, unknown>>
    >();
    /* eslint-enable @typescript-eslint/unbound-method */
  });
});
