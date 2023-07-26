import {
  createWebSocketObservable,
  CreateWebSocketObservableConfig,
  GetWebSocketMessagesObservable,
  WebSocketMessageType,
} from './create-web-socket-observable';
import {
  BehaviorSubject,
  delay,
  filter,
  identity,
  map,
  merge,
  Observable,
  Observer,
  of,
  retry,
  RetryConfig,
  share,
  Subject,
  Subscription,
  switchMap,
  tap,
} from 'rxjs';
import { QueueSubject } from './queue-subject';

export interface WebSocketConnectorConfig extends CreateWebSocketObservableConfig {
  serializer?: SerializeFn<any>;
  deserializer?: DeserializeFn<any>;
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
export type DeserializeFn<T> = (value: any) => T;

const DEFAULT_PARAMS: Partial<WebSocketConnectorConfig> = {
  deserializer: (value) => JSON.parse(value),
  serializer: (value) => JSON.stringify(value),
};

export class WebSocketConnector<T extends WebSocketMessageType = WebSocketMessageType> {
  private readonly socket$: Observable<GetWebSocketMessagesObservable<T>>;
  private readonly statusSubject = new BehaviorSubject<Status>(STATUS.uninitialized);
  private readonly requestsSubject = new QueueSubject<unknown>();
  private readonly messagesSubject = new Subject<unknown>();
  private readonly forceReconnectSubject = new Subject<string>();
  private readonly sharedMessages$ = this.messagesSubject.pipe(share());
  private messagesSubscription: Subscription | undefined;
  private readonly serializer: SerializeFn<unknown>;
  private readonly deserializer: DeserializeFn<unknown>;
  private messagesObserver: Observer<any> = {
    next: (message) => {
      this.messagesSubject.next(message);
    },
    error: (error) => {
      this.statusSubject.next(STATUS.disconnected);
      this.messagesSubject.error(error);
    },
    complete: () => {
      this.statusSubject.next(STATUS.disconnected);
      this.messagesSubject.complete();
      this.requestsSubject.complete();
      this.forceReconnectSubject.complete();
    },
  };

  constructor(params: WebSocketConnectorConfig) {
    this.serializer = params.serializer ?? DEFAULT_PARAMS.serializer;
    this.deserializer = params.deserializer ?? DEFAULT_PARAMS.deserializer;
    const { url, protocols, createWebSocketInstance } = params;
    this.socket$ = createWebSocketObservable<T>({
      createWebSocketInstance,
      protocols,
      url,
    });
  }

  private applySerialization = (getWebSocketMessagesFn: GetWebSocketMessagesObservable<T>) => {
    return getWebSocketMessagesFn(this.requestsSubject.pipe(map((r) => this.serializer(r)))).pipe(
      map((r) => this.deserializer(r)),
    );
  };

  public connect = (config?: ConnectConfig): void => {
    const retryConfig = config?.retryConfig;

    if (this.messagesSubscription) throw new Error(`socket connection is already opened`);

    const getWebSocketMessages$ = merge(
      this.socket$,
      this.forceReconnectSubject.pipe(
        tap((message) => {
          throw new Error(message);
        }),
      ),
    ).pipe(filter((v): v is GetWebSocketMessagesObservable<T> => typeof v === 'function'));

    this.messagesSubscription = getWebSocketMessages$
      .pipe(
        switchMap((getWebSocketMessagesFn) => {
          if (this.statusSubject.value === STATUS.reconnecting && retryConfig?.onSuccess) {
            retryConfig.onSuccess();
          }
          this.statusSubject.next(STATUS.connected);
          return this.applySerialization(getWebSocketMessagesFn);
        }),
        retryConfig
          ? retry({
              resetOnSuccess: true,
              count: retryConfig.count,
              delay: (error, retryCount) => {
                if (retryCount === 1) {
                  this.statusSubject.next(STATUS.reconnecting);
                }
                if (typeof retryConfig.delay === 'number') {
                  return of(true).pipe(delay(retryConfig.delay));
                }
                return retryConfig.delay(error, retryCount);
              },
            })
          : identity,
      )
      .subscribe(this.messagesObserver);
  };

  public send<T>(data: T): void {
    this.requestsSubject.next(data);
  }

  public messages = <T>(): Observable<T> => {
    return this.sharedMessages$ as Observable<T>;
  };

  public get status$(): Observable<Status> {
    return this.statusSubject.asObservable();
  }

  public disconnect = (): void => {
    if (!this.messagesSubscription) throw new Error(`socket connection was not yet established`);
    this.statusSubject.next(STATUS.disconnected);
    this.messagesSubscription.unsubscribe();
    this.messagesSubscription = undefined;
  };

  public forceReconnect = (errorMessage: string = forceReconnectMessage): void => {
    this.forceReconnectSubject.next(errorMessage);
  };
}
