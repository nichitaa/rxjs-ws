import type {
  CreateWebSocketObservableConfig,
  GetWebSocketMessagesObservable,
  WebSocketMessageType,
} from './create-web-socket-observable';
import { createWebSocketObservable } from './create-web-socket-observable';
import type { Observable, Observer, RetryConfig, Subscription } from 'rxjs';
import {
  BehaviorSubject,
  delay,
  filter,
  identity,
  map,
  merge,
  of,
  retry,
  share,
  Subject,
  switchMap,
  tap,
} from 'rxjs';
import { QueueSubject } from './queue-subject';

export interface WebSocketConnectorConfig extends CreateWebSocketObservableConfig {
  serializer?: SerializeFn<unknown>;
  deserializer?: DeserializeFn<unknown>;
}

export interface ConnectConfig {
  retryConfig?: Omit<RetryConfig, 'resetOnSuccess'> & {
    onSuccess?: () => void;
  };
}

export const STATUS = {
  uninitialized: 'uninitialized',
  connected: 'connected',
  reconnecting: 'reconnecting',
  disconnected: 'disconnected',
} as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];

export const forceReconnectMessage = 'force reconnect' as const;

export type SerializeFn<T> = (value: T) => WebSocketMessageType;
export type DeserializeFn<T> = (value: unknown) => T;

const DEFAULT_PARAMS: Required<Pick<WebSocketConnectorConfig, 'deserializer' | 'serializer'>> = {
  deserializer: (value) => {
    if (typeof value !== 'string') throw new Error('value must be string');
    return JSON.parse(value) as unknown;
  },
  serializer: (value) => JSON.stringify(value),
};

export class WebSocketConnector<T extends WebSocketMessageType = WebSocketMessageType> {
  readonly #socket$: Observable<GetWebSocketMessagesObservable<T>>;
  readonly #statusSubject = new BehaviorSubject<Status>(STATUS.uninitialized);
  readonly #requestsSubject = new QueueSubject<unknown>();
  readonly #messagesSubject = new Subject<unknown>();
  readonly #forceReconnectSubject = new Subject<string>();
  readonly #sharedMessages$ = this.#messagesSubject.pipe(share());
  #messagesSubscription: Subscription | undefined;
  readonly #serializer: SerializeFn<unknown>;
  readonly #deserializer: DeserializeFn<unknown>;
  #messagesObserver: Observer<unknown> = {
    next: (message) => {
      this.#messagesSubject.next(message);
    },
    error: (error) => {
      this.#statusSubject.next(STATUS.disconnected);
      this.#messagesSubject.error(error);
    },
    complete: () => {
      this.#statusSubject.next(STATUS.disconnected);
      this.#messagesSubject.complete();
      this.#requestsSubject.complete();
      this.#forceReconnectSubject.complete();
    },
  };

  constructor(params: WebSocketConnectorConfig) {
    this.#serializer = params.serializer ?? DEFAULT_PARAMS.serializer;
    this.#deserializer = params.deserializer ?? DEFAULT_PARAMS.deserializer;
    const { url, protocols, createWebSocketInstance } = params;
    this.#socket$ = createWebSocketObservable<T>({
      createWebSocketInstance,
      protocols,
      url,
    });
  }

  #applySerialization = (getWebSocketMessagesFn: GetWebSocketMessagesObservable<T>) => {
    return getWebSocketMessagesFn(this.#requestsSubject.pipe(map((r) => this.#serializer(r)))).pipe(
      map((r) => this.#deserializer(r)),
    );
  };

  connect = (config?: ConnectConfig): void => {
    const retryConfig = config?.retryConfig;

    if (this.#messagesSubscription) throw new Error(`socket connection is already opened`);

    const getWebSocketMessages$ = merge(
      this.#socket$,
      this.#forceReconnectSubject.pipe(
        tap((message) => {
          if (!retryConfig) {
            console.warn(
              'forceReconnect requires `retryConfig` to properly reconnect to socket, otherwise it will emit an observable.error()',
            );
          }
          throw new Error(message);
        }),
      ),
    ).pipe(filter((v): v is GetWebSocketMessagesObservable<T> => typeof v === 'function'));

    this.#messagesSubscription = getWebSocketMessages$
      .pipe(
        switchMap((getWebSocketMessagesFn) => {
          if (this.#statusSubject.value === STATUS.reconnecting && retryConfig?.onSuccess) {
            retryConfig.onSuccess();
          }
          this.#statusSubject.next(STATUS.connected);
          return this.#applySerialization(getWebSocketMessagesFn);
        }),
        retryConfig
          ? retry({
              resetOnSuccess: true,
              count: retryConfig.count,
              delay: (error, retryCount) => {
                if (retryCount === 1) {
                  this.#statusSubject.next(STATUS.reconnecting);
                }
                if (typeof retryConfig.delay === 'number') {
                  return of(true).pipe(delay(retryConfig.delay));
                }
                if (typeof retryConfig.delay === 'function') {
                  return retryConfig.delay(error, retryCount);
                }
                return of(true);
              },
            })
          : identity,
      )
      .subscribe(this.#messagesObserver);
  };

  send<T>(data: T): void {
    this.#requestsSubject.next(data);
  }

  messages = <T>(): Observable<T> => {
    return this.#sharedMessages$ as Observable<T>;
  };

  get status$(): Observable<Status> {
    return this.#statusSubject.asObservable();
  }

  disconnect = (): void => {
    if (!this.#messagesSubscription) throw new Error(`socket connection was not yet established`);
    this.#statusSubject.next(STATUS.disconnected);
    this.#messagesSubscription.unsubscribe();
    this.#messagesSubscription = undefined;
  };

  forceReconnect = (errorMessage: string = forceReconnectMessage): void => {
    this.#forceReconnectSubject.next(errorMessage);
  };
}
