import { BehaviorSubject, Observable, RetryConfig } from 'rxjs';
import { CONNECTION_STATUS, STREAM_STATUS } from './constants';
import { defaultCreateWebSocketInstance } from './utils';

export type WebSocketMessageType = string | ArrayBuffer | Blob | ArrayBufferView;

export interface EventWithMessage extends Event {
  message?: string;
}

export interface CreateWebSocketObservableConfig {
  url: string | URL;
  protocols?: string | string[];
  createWebSocketInstance?: typeof defaultCreateWebSocketInstance;
}

export type GetWebSocketEvents$ = (
  requests$: Observable<WebSocketMessageType>,
) => Observable<MessageEvent>;

export interface WebSocketConnectorConfig extends CreateWebSocketObservableConfig {
  serializer?: SerializeFn;
  deserializer?: DeserializeFn;
}

export interface ConnectConfig {
  retryConfig?: Omit<RetryConfig, 'resetOnSuccess'> & {
    onSuccess?: () => void;
  };
}

export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

export type SerializeFn<T = unknown> = (value: T) => WebSocketMessageType;

export type DeserializeFn<T = unknown> = (value: unknown) => T;

export type StreamStatus = (typeof STREAM_STATUS)[keyof typeof STREAM_STATUS];

export interface StreamResponse<TRes, TReq, TErr> {
  status: StreamStatus;
  response?: TRes;
  request?: TReq;
  error?: TErr;
}

export interface StreamHandlerParams<TEvent, TRes = TEvent, TReq = unknown> {
  default: TRes;
  transformRequests: TransformOperator<SendRequestParams<TEvent, TRes, TReq>>;
  resetResponseOnNextRequest: boolean;
  resetErrorOnNextRequest: boolean;
  awaitReadyStatusBeforeNextRequest: boolean;
}

export interface StreamHandler<TEvent, TRes = TEvent, TReq = unknown, TErr = unknown> {
  $: BehaviorSubject<StreamResponse<TRes, TReq, TErr>>;

  send(params: SendRequestParams<TEvent, TRes, TReq>): void;
}

export interface SendRequestParams<TEvent, TRes, TReq> {
  request: TReq;
  transformResponse?: TransformOperator<TEvent, TRes>;
}

export type TransformOperator<TIn, TOut = TIn> = (source$: Observable<TIn>) => Observable<TOut>;
