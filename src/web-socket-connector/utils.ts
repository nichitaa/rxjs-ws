import type { Observable } from 'rxjs';
import { filter } from 'rxjs';
import { DeserializeFn, SerializeFn } from './types';

export const defaultSerializer: SerializeFn<unknown> = (value) => JSON.stringify(value);

export const defaultDeserializer: DeserializeFn<unknown> = (value) => {
  if (typeof value !== 'string') throw new Error('value must be string');
  return JSON.parse(value) as unknown;
};

export function isNotNullOrUndefined<T>(input: null | undefined | T): input is T {
  return input !== null && input !== undefined;
}

export function filterNullAndUndefined<T>() {
  return (source$: Observable<null | undefined | T>) => source$.pipe(filter(isNotNullOrUndefined));
}
