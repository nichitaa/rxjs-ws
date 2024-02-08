import { createWebSocket$ } from './create-web-socket-observable';
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
  shareReplay,
  Subject,
  Subscription,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs';
import { QueueSubject } from './queue-subject';
import {
  ConnectConfig,
  DeserializeFn,
  GetWebSocketEvents$,
  SerializeFn,
  ConnectionStatus,
  StreamHandlerParams,
  SendRequestParams,
  StreamResponse,
  TransformOperator,
  WebSocketConnectorConfig,
  StreamHandler,
  TransformResponse,
} from './types';
import { CONNECTION_STATUS, FORCE_RECONNECT_MESSAGE, STREAM_STATUS } from './constants';
import { defaultDeserializer, defaultSerializer, filterNullAndUndefined } from './utils';

export class WebSocketConnector {
  #socket$: Observable<GetWebSocketEvents$>;
  #status$ = new BehaviorSubject<ConnectionStatus>(CONNECTION_STATUS.uninitialized);

  #events$ = new Subject<MessageEvent>();
  events$ = this.#events$.asObservable();

  #forceReconnect$ = new Subject<string>();

  #eventsSubscription: Subscription | undefined;

  #serializer: SerializeFn;
  #deserializer: DeserializeFn;

  #sharedMessages$ = this.#events$.pipe(
    map(({ data }) => this.#deserializer(data)),
    share(),
  );
  #requestsQueue$ = new QueueSubject();
  #requests$ = this.#requestsQueue$.pipe(map((request) => this.#serializer(request)));

  #eventsObserver: Observer<MessageEvent> = {
    next: (event) => {
      this.#events$.next(event);
    },
    error: (error) => {
      this.#status$.next(CONNECTION_STATUS.disconnected);
      this.#events$.error(error);
    },
    complete: () => {
      this.#status$.next(CONNECTION_STATUS.disconnected);
      this.#events$.complete();
      this.#requestsQueue$.complete();
      this.#forceReconnect$.complete();
    },
  };

  constructor({
    serializer = defaultSerializer,
    deserializer = defaultDeserializer,
    ...createSocketParams
  }: WebSocketConnectorConfig) {
    this.#serializer = serializer;
    this.#deserializer = deserializer;
    this.#socket$ = createWebSocket$(createSocketParams);
  }

  connect = (config?: ConnectConfig): void => {
    const retryConfig = config?.retryConfig;

    if (this.#eventsSubscription) throw new Error(`socket connection is already opened`);

    const getWebSocketMessages$ = merge(
      this.#socket$,
      this.#forceReconnect$.pipe(
        tap((message) => {
          if (!retryConfig) {
            const warn =
              'forceReconnect requires `retryConfig` to properly reconnect to socket, otherwise it will emit an observable.error()';
            console.warn(warn);
          }
          throw new Error(message);
        }),
      ),
    ).pipe(filter((v): v is GetWebSocketEvents$ => typeof v === 'function'));

    this.#eventsSubscription = getWebSocketMessages$
      .pipe(
        switchMap((getWebSocketMessagesFn) => {
          if (this.#status$.value === CONNECTION_STATUS.reconnecting && retryConfig?.onSuccess) {
            retryConfig.onSuccess();
          }
          this.#status$.next(CONNECTION_STATUS.connected);
          return getWebSocketMessagesFn(this.#requests$);
        }),
        retryConfig
          ? retry({
              resetOnSuccess: true,
              count: retryConfig.count,
              delay: (error, retryCount) => {
                if (retryCount === 1) {
                  this.#status$.next(CONNECTION_STATUS.reconnecting);
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
      .subscribe(this.#eventsObserver);
  };

  send<T>(data: T) {
    this.#requestsQueue$.next(data);
  }

  messages = <T>(): Observable<T> => {
    return this.#sharedMessages$ as Observable<T>;
  };

  get status$(): Observable<ConnectionStatus> {
    return this.#status$.asObservable();
  }

  disconnect = () => {
    if (!this.#eventsSubscription) throw new Error(`socket connection was not yet established`);
    this.#status$.next(CONNECTION_STATUS.disconnected);
    this.#eventsSubscription.unsubscribe();
    this.#eventsSubscription = undefined;
  };

  forceReconnect = (errorMessage: string = FORCE_RECONNECT_MESSAGE) => {
    this.#forceReconnect$.next(errorMessage);
  };

  getStreamHandler = <TEvent, TRes = TEvent, TReqIn = unknown, TReqOut = TReqIn, TErr = unknown>(
    params: Partial<StreamHandlerParams<TEvent, TRes, TReqIn, TReqOut>> = {},
  ): StreamHandler<TEvent, TRes, TReqIn, TReqOut, TErr> => {
    const defaultTransformRequest = identity as TransformOperator<
      SendRequestParams<TEvent, TRes, TReqIn, TReqOut>,
      SendRequestParams<TEvent, TRes, TReqOut>
    >;

    const {
      default: defaultResponse = undefined,
      transformRequests = defaultTransformRequest,
      resetResponseOnNextRequest = true,
      resetErrorOnNextRequest = true,
      awaitReadyStatusBeforeNextRequest = true,
    } = params;

    const requests$ = new BehaviorSubject<
      undefined | SendRequestParams<TEvent, TRes, TReqIn, TReqOut>
    >(undefined);
    const uninitializedValue: StreamResponse<TRes, TReqOut, TErr> = {
      status: STREAM_STATUS.uninitialized,
      response: defaultResponse,
    };
    const $ = new BehaviorSubject<StreamResponse<TRes, TReqOut, TErr>>(uninitializedValue);
    const userRequests$ = requests$.pipe(
      filterNullAndUndefined(),
      transformRequests,
      shareReplay(1),
    );

    userRequests$
      .pipe(
        concatMap((currentProcessingRequest) => {
          const defaultTransformResponse = (() => identity) as TransformResponse<
            TEvent,
            TRes,
            TReqOut
          >;

          const { request, transformResponse = defaultTransformResponse } =
            currentProcessingRequest;

          const ready$ = this.messages<TEvent>().pipe(
            transformResponse(request),
            map((response) => ({
              response,
              error: undefined,
            })),
            catchError((error: TErr) => of({ error })),
            map((value) => ({
              ...value,
              status: STREAM_STATUS.ready,
            })),
            shareReplay(1),
          );

          const wsDisconnectedStatus$ = this.status$.pipe(
            filter(
              (status) =>
                status === CONNECTION_STATUS.disconnected ||
                status === CONNECTION_STATUS.reconnecting,
            ),
            tap(() => {
              $.next(uninitializedValue);
            }),
            take(1),
          );

          const newRequest$ = defer(() => {
            const nextRequest$ = userRequests$.pipe(
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
            filter((x) => x === CONNECTION_STATUS.connected),
            take(1),
          );

          const loading$: Observable<StreamResponse<TRes, TReqOut, TErr>> = wsConnectedStatus$.pipe(
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

    const send = (params: SendRequestParams<TEvent, TRes, TReqIn, TReqOut>) => {
      // create a shallow copy of the send request params to referentially check it in nextRequest$
      requests$.next({ ...params });
    };

    return {
      send,
      $,
    };
  };
}
