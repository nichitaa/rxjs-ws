// ref: https://github.com/insidewhy/rxjs-websockets

import { Observable, Subscription, Subject } from 'rxjs';

export type WebSocketMessageType = string | ArrayBuffer | Blob | ArrayBufferView;

export interface EventWithMessage extends Event {
  message?: string;
}

export class ErrorWithReasonAndCode extends Error {
  code: number;
  reason: string;

  constructor({ code, message, reason }: { message: string; code: number; reason: string }) {
    super(message);
    this.code = code;
    this.reason = reason;
  }
}

export const defaultCreateWebSocket = (url: string | URL, protocols?: string | string[]) =>
  new WebSocket(url, protocols);

export type CreateWebSocketObservableConfig = {
  url: string | URL;
  protocols?: string | string[];
  createWebSocketInstance?: typeof defaultCreateWebSocket;
};

export type GetWebSocketMessagesObservable<T = WebSocketMessageType> = (
  requests$: Observable<WebSocketMessageType>,
) => Observable<T>;

export const createWebSocketObservable = <T extends WebSocketMessageType = WebSocketMessageType>(
  params: CreateWebSocketObservableConfig,
): Observable<GetWebSocketMessagesObservable<T>> => {
  const { createWebSocketInstance = defaultCreateWebSocket, url, protocols } = params;

  return new Observable((observer) => {
    let requestsSubscription: Subscription;
    const messagesSubject = new Subject<T>();

    const socket = createWebSocketInstance(url, protocols);

    let isSocketClosed = false;
    let closedByTeardown = false;

    const setClosedStatus = () => {
      isSocketClosed = true;
    };

    const getWebSocketMessagesObservable: GetWebSocketMessagesObservable<T> = (requests$) => {
      if (requestsSubscription) {
        setClosedStatus();
        const error = new Error('`getWebSocketMessagesObservable` called more than once');
        observer.error(error);
        throw error;
      }
      requestsSubscription = requests$.subscribe((data) => {
        socket.send(data);
      });
      return messagesSubject.asObservable();
    };

    socket.onopen = (): void => {
      if (closedByTeardown) {
        setClosedStatus();
        socket.close();
      } else {
        observer.next(getWebSocketMessagesObservable);
      }
    };

    socket.onmessage = ({ data }) => {
      messagesSubject.next(data);
    };

    socket.onerror = (error: EventWithMessage) => {
      setClosedStatus();
      observer.error(new Error(`WebSocket error ${error?.message}`));
    };

    socket.onclose = (event) => {
      // prevent observer.complete() being called after observer.error(...)
      if (isSocketClosed) return;

      setClosedStatus();
      if (closedByTeardown) {
        observer.complete();
        messagesSubject.complete();
      } else {
        const { reason, code } = event;
        const error = new ErrorWithReasonAndCode({
          message: 'Unexpected WebSocket close',
          code,
          reason,
        });

        observer.error(error);
        messagesSubject.error(error);
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
};
