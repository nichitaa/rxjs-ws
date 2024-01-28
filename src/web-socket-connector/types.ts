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
export type StreamResponse<TResponse, TRequest, TError> = {
  status: StreamStatus;
  response?: TResponse;
  request?: TRequest;
  error?: TError;
};
export type StreamHandlerParams<TIncomingMessages, TResponse, TRequest, TError> = {
  default: TResponse;
  transformRequests: (
    source$: Observable<StreamHandlerSendParams<TIncomingMessages, TResponse, TRequest, TError>>,
  ) => Observable<StreamHandlerSendParams<TIncomingMessages, TResponse, TRequest, TError>>;
  resetResponseOnNextRequest: boolean;
  resetErrorOnNextRequest: boolean;
  awaitReadyStatusBeforeNextRequest: boolean;
};
export type StreamHandlerSendParams<TIncomingMessages, TResponse, TRequest, TError> = {
  request: TRequest;
  transformResponse: (source$: Observable<TIncomingMessages>) => Observable<TResponse>;
};
