// ref: https://github.com/insidewhy/rxjs-websockets

import type { Subscription } from 'rxjs';
import { Observable, Subject } from 'rxjs';
import { defaultCreateWebSocketInstance } from './utils';
import type {
  CreateWebSocketObservableConfig,
  GetWebSocketEvents$,
  WebSocketMessageType,
} from './types';

export const createWebSocket$ = ({
  createWebSocketInstance = defaultCreateWebSocketInstance,
  url,
  protocols,
}: CreateWebSocketObservableConfig): Observable<GetWebSocketEvents$> =>
  new Observable((subscriber) => {
    let requestsSubscription: Subscription;
    const events$ = new Subject<MessageEvent>();

    const socket = createWebSocketInstance(url, protocols);

    let isSocketClosed = false;
    let closedByTeardown = false;

    const setClosedStatus = () => {
      isSocketClosed = true;
    };

    const getWebSocketEvents$: GetWebSocketEvents$ = (requests$) => {
      if (requestsSubscription) {
        setClosedStatus();
        const error = new Error('`getWebSocketMessagesObservable` called more than once');
        subscriber.error(error);
        throw error;
      }
      requestsSubscription = requests$.subscribe((data: WebSocketMessageType) => {
        socket.send(data);
      });
      return events$.asObservable();
    };

    socket.onopen = (): void => {
      if (closedByTeardown) {
        setClosedStatus();
        socket.close();
      } else {
        subscriber.next(getWebSocketEvents$);
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      events$.next(event);
    };

    socket.onerror = (error) => {
      setClosedStatus();
      subscriber.error(error);
    };

    socket.onclose = (event) => {
      // prevent subscriber.complete() being called after subscriber.error(...)
      if (isSocketClosed) return;

      setClosedStatus();
      if (closedByTeardown) {
        subscriber.complete();
        events$.complete();
      } else {
        subscriber.error(event);
        events$.error(event);
      }
    };

    return () => {
      closedByTeardown = true;
      if (requestsSubscription) requestsSubscription.unsubscribe();

      if (!isSocketClosed) {
        socket.close(1000);
      }
    };
  });
