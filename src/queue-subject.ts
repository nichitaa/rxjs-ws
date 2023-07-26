import { PartialObserver, Subject, Subscription } from 'rxjs';

export class QueueSubject<T> extends Subject<T> {
  private queuedValues: T[] = [];

  next(value: T): void {
    if (this.closed || this.observed) super.next(value);
    else this.queuedValues.push(value);
  }

  subscribe(observerOrNext?: PartialObserver<T> | ((value: T) => void)): Subscription {
    const subscription = super.subscribe(observerOrNext);
    if (this.queuedValues.length) {
      this.queuedValues.forEach((value) => super.next(value));
      this.queuedValues.splice(0);
    }
    return subscription;
  }
}
