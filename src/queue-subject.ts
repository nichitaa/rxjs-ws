// ref: https://github.com/insidewhy/queueing-subject/blob/master/src/index.ts

import type { Observer, Subscription } from 'rxjs';
import { Subject } from 'rxjs';

export class QueueSubject<T> extends Subject<T> {
  private queuedValues: T[] = [];

  override next(value: T): void {
    if (this.closed || this.observed) super.next(value);
    else this.queuedValues.push(value);
  }

  override subscribe(
    observerOrNext?: Partial<Observer<T>> | ((value: T) => void) | null,
    error?: ((error: unknown) => void) | null,
    complete?: (() => void) | null
  ): Subscription {
    if (observerOrNext == null) {
      return super.subscribe(null, error, complete);
    } else {
      const subscription =
        typeof observerOrNext === 'function'
          ? super.subscribe(observerOrNext, error, complete)
          : super.subscribe(observerOrNext);
      if (this.queuedValues.length) {
        this.queuedValues.forEach((value) => super.next(value));
        this.queuedValues.splice(0);
      }
      return subscription;
    }
  }
}
