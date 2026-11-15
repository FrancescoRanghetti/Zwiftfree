import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { RidesApi } from '../api/rides.api';
import { RideDetail } from '../api/rides.models';
import { IndexedDbQueueStore, MemoryQueueStore, QueueStore, QueuedItem } from './ride-queue';

export const RIDE_QUEUE_STORE = new InjectionToken<QueueStore>('RIDE_QUEUE_STORE', {
  providedIn: 'root',
  factory: () =>
    IndexedDbQueueStore.available() ? new IndexedDbQueueStore() : new MemoryQueueStore(),
});

/** Retry delay after a network failure. */
export const RETRY_MS = 15_000;

/**
 * Sends ride data in order through a persistent queue: every block is stored first, then posted. Network errors
 * and 5xx keep the block for a later retry (timer, `online` event, next app start); 4xx answers (ride deleted or
 * already completed) drop it. The backend upserts samples on (ride, t), so a block sent twice is harmless.
 */
@Injectable({ providedIn: 'root' })
export class RideUploader {
  private readonly api = inject(RidesApi);
  private readonly store = inject(RIDE_QUEUE_STORE);
  private flushing: Promise<boolean> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  /** Blocks not yet accepted by the backend. */
  readonly pending = signal(0);
  readonly offline = signal(false);

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('online', () => void this.flush());
  }

  async enqueue(item: QueuedItem): Promise<void> {
    await this.store.add(item);
    this.pending.update((n) => n + 1);
    void this.flush();
  }

  /** Sends everything queued. Resolves true when the queue is empty afterwards. */
  flush(): Promise<boolean> {
    this.flushing ??= this.doFlush().finally(() => (this.flushing = null));
    return this.flushing;
  }

  /**
   * Sends what is queued for the ride, then completes it. Returns null if the backend cannot be reached:
   * the completion stays queued and happens on the next successful flush.
   */
  async complete(rideId: string): Promise<RideDetail | null> {
    const empty = await this.flush();
    if (empty) {
      try {
        return await firstValueFrom(this.api.complete(rideId));
      } catch (e) {
        if (!retryable(e)) throw e;
      }
    }
    await this.enqueue({ rideId, kind: 'complete' });
    return null;
  }

  private async doFlush(): Promise<boolean> {
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    let items: QueuedItem[];
    try {
      items = await this.store.all();
    } catch {
      return false;
    }
    this.pending.set(items.length);
    for (const item of items) {
      try {
        await firstValueFrom(this.send(item));
      } catch (e) {
        if (retryable(e)) {
          this.offline.set(true);
          this.retry = setTimeout(() => void this.flush(), RETRY_MS);
          return false;
        }
        console.warn('Ride upload rejected, dropping block', item.kind, e);
      }
      await this.store.remove(item.key!);
      this.pending.update((n) => Math.max(0, n - 1));
    }
    this.offline.set(false);
    return true;
  }

  private send(item: QueuedItem): Observable<unknown> {
    switch (item.kind) {
      case 'samples':
        return this.api.samples(item.rideId, item.body);
      case 'events':
        return this.api.events(item.rideId, item.body);
      case 'complete':
        return this.api.complete(item.rideId);
    }
  }
}

function retryable(e: unknown): boolean {
  return !(e instanceof HttpErrorResponse) || e.status === 0 || e.status >= 500 || e.status === 401;
}
