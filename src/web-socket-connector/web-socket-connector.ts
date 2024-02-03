import type {
  GetWebSocketMessagesObservable,
  WebSocketMessageType,
} from '../create-web-socket-observable';
import { createWebSocketObservable } from '../create-web-socket-observable';
import {
  asyncScheduler,
  BehaviorSubject,
  catchError,
  concat,
  concatMap,
  defer,
  delay,
  filter,
  identity,
  map,
  merge,
  Observable,
  observeOn,
  Observer,
  of,
  race,
  retry,
  share,
  Subject,
  Subscription,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs';
import { QueueSubject } from '../queue-subject';
import {
  ConnectConfig,
  DeserializeFn,
  SerializeFn,
  Status,
  StreamHandlerParams,
  StreamHandlerSendRequestParams,
  StreamResponse,
  TransformResponseOperator,
  WebSocketConnectorConfig,
} from './types';
import { CONN_STATUS, FORCE_RECONNECT_MESSAGE, STREAM_STATUS } from './constants';
import { defaultDeserializer, defaultSerializer, filterNullAndUndefined } from './utils';

export class WebSocketConnector<T extends WebSocketMessageType = WebSocketMessageType> {
  #socket$: Observable<GetWebSocketMessagesObservable<T>>;
  #statusSubject = new BehaviorSubject<Status>(CONN_STATUS.uninitialized);
  #requestsSubject = new QueueSubject<unknown>();
  #messagesSubject = new Subject<unknown>();
  #forceReconnectSubject = new Subject<string>();
  #sharedMessages$ = this.#messagesSubject.pipe(share());
  #messagesSubscription: Subscription | undefined;
  #serializer: SerializeFn<unknown>;
  #deserializer: DeserializeFn<unknown>;
  #messagesObserver: Observer<unknown> = {
    next: (message) => {
      this.#messagesSubject.next(message);
    },
    error: (error) => {
      this.#statusSubject.next(CONN_STATUS.disconnected);
      this.#messagesSubject.error(error);
    },
    complete: () => {
      this.#statusSubject.next(CONN_STATUS.disconnected);
      this.#messagesSubject.complete();
      this.#requestsSubject.complete();
      this.#forceReconnectSubject.complete();
    },
  };

  constructor(params: WebSocketConnectorConfig) {
    this.#serializer = params.serializer ?? defaultSerializer;
    this.#deserializer = params.deserializer ?? defaultDeserializer;
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
          if (this.#statusSubject.value === CONN_STATUS.reconnecting && retryConfig?.onSuccess) {
            retryConfig.onSuccess();
          }
          this.#statusSubject.next(CONN_STATUS.connected);
          return this.#applySerialization(getWebSocketMessagesFn);
        }),
        retryConfig
          ? retry({
              resetOnSuccess: true,
              count: retryConfig.count,
              delay: (error, retryCount) => {
                if (retryCount === 1) {
                  this.#statusSubject.next(CONN_STATUS.reconnecting);
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
    this.#statusSubject.next(CONN_STATUS.disconnected);
    this.#messagesSubscription.unsubscribe();
    this.#messagesSubscription = undefined;
  };

  forceReconnect = (errorMessage: string = FORCE_RECONNECT_MESSAGE): void => {
    this.#forceReconnectSubject.next(errorMessage);
  };

  getStreamHandler = <TEvent, TRes = TEvent, TReq = unknown, TErr = unknown>(
    params: Partial<StreamHandlerParams<TEvent, TRes, TReq>> = {},
  ) => {
    const {
      default: defaultResponse = undefined,
      transformRequests = identity,
      resetResponseOnNextRequest = true,
      resetErrorOnNextRequest = true,
      awaitReadyStatusBeforeNextRequest = true,
    } = params;

    const requests$ = new BehaviorSubject<
      undefined | StreamHandlerSendRequestParams<TEvent, TRes, TReq>
    >(undefined);

    const uninitializedValue: StreamResponse<TRes, TReq, TErr> = {
      status: STREAM_STATUS.uninitialized,
      response: defaultResponse,
    };

    const $ = new BehaviorSubject<StreamResponse<TRes, TReq, TErr>>(uninitializedValue);

    requests$
      .pipe(
        filterNullAndUndefined(),
        transformRequests,
        concatMap((currentProcessingRequest) => {
          const defaultTransformResponse = identity as TransformResponseOperator<TEvent, TRes>;
          const { request, transformResponse = defaultTransformResponse } =
            currentProcessingRequest;

          const ready$ = this.messages<TEvent>().pipe(
            transformResponse,
            map((response) => ({
              response,
              error: undefined,
            })),
            catchError((error: TErr) => of({ error })),
            map((value) => ({
              ...value,
              status: STREAM_STATUS.ready,
            })),
          );

          const wsDisconnectedStatus$ = this.status$.pipe(
            filter(
              (status) =>
                status === CONN_STATUS.disconnected || status === CONN_STATUS.reconnecting,
            ),
            tap(() => {
              $.next(uninitializedValue);
            }),
            take(1),
          );

          const newRequest$ = defer(() => {
            const nextRequest$ = requests$.pipe(
              filter((x) => x !== currentProcessingRequest),
              take(1),
            );
            return nextRequest$.pipe(
              concatMap(() => {
                if (awaitReadyStatusBeforeNextRequest) return ready$.pipe(take(1));
                return of(true);
              }),
            );
          });

          const takeUntil$ = race(wsDisconnectedStatus$, newRequest$).pipe(
            // this allows for subscription of the concat(ready$) to run and next the emission of ready$
            // before emitting newRequest$
            observeOn(asyncScheduler),
          );

          const wsConnectedStatus$ = this.status$.pipe(
            filter((x) => x === CONN_STATUS.connected),
            take(1),
          );

          const loading$: Observable<StreamResponse<TRes, TReq, TErr>> = wsConnectedStatus$.pipe(
            concatMap(() =>
              of({
                status: STREAM_STATUS.loading,
                request,
                response: resetResponseOnNextRequest ? undefined : $.value.response,
                error: resetErrorOnNextRequest ? undefined : $.value.error,
              }).pipe(
                tap(({ request }) => {
                  this.send(request);
                }),
              ),
            ),
          );

          const concat$ = concat(loading$, ready$.pipe(takeUntil(takeUntil$))).pipe(
            tap((value) => {
              $.next({ ...$.value, ...value });
            }),
          );

          return concat$;
        }),
      )
      .subscribe({
        complete: () => {
          throw new Error('[getStreamHandler] should never complete');
        },
      });

    const send = (params: StreamHandlerSendRequestParams<TEvent, TRes, TReq>) => {
      // create a shallow copy of the send request params to referentially check it in nextRequest$
      requests$.next({ ...params });
    };

    return {
      send,
      $,
    };
  };
}
