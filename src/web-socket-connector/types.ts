import { Observable, RetryConfig } from 'rxjs';
import type {
  CreateWebSocketObservableConfig,
  WebSocketMessageType,
} from '../create-web-socket-observable';
import { CONN_STATUS, STREAM_STATUS } from './constants';

export interface WebSocketConnectorConfig extends CreateWebSocketObservableConfig {
  serializer?: SerializeFn<unknown>;
  deserializer?: DeserializeFn<unknown>;
}

export interface ConnectConfig {
  retryConfig?: Omit<RetryConfig, 'resetOnSuccess'> & {
    onSuccess?: () => void;
  };
}

export type Status = (typeof CONN_STATUS)[keyof typeof CONN_STATUS];

export type SerializeFn<T> = (value: T) => WebSocketMessageType;

export type DeserializeFn<T> = (value: unknown) => T;

export type StreamStatus = (typeof STREAM_STATUS)[keyof typeof STREAM_STATUS];

export type StreamResponse<TRes, TReq, TErr> = {
  status: StreamStatus;
  response?: TRes;
  request?: TReq;
  error?: TErr;
};

export type StreamHandlerParams<TEvent, TRes, TReq> = {
  default: TRes;
  transformRequests: TransformResponseOperator<StreamHandlerSendRequestParams<TEvent, TRes, TReq>>;
  resetResponseOnNextRequest: boolean;
  resetErrorOnNextRequest: boolean;
  awaitReadyStatusBeforeNextRequest: boolean;
};

export type StreamHandlerSendRequestParams<TEvent, TRes, TReq> = {
  request: TReq;
  transformResponse?: TransformResponseOperator<TEvent, TRes>;
};

export type TransformResponseOperator<TIn, TOut = TIn> = (
  source$: Observable<TIn>,
) => Observable<TOut>;
