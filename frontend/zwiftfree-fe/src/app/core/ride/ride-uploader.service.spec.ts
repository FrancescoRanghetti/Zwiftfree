import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MemoryQueueStore } from './ride-queue';
import { RIDE_QUEUE_STORE, RideUploader } from './ride-uploader.service';

const BLOCK = { samples: [], edges: [] };

describe('RideUploader', () => {
  let uploader: RideUploader;
  let http: HttpTestingController;
  let store: MemoryQueueStore;

  beforeEach(() => {
    store = new MemoryQueueStore();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RIDE_QUEUE_STORE, useValue: store },
      ],
    });
    uploader = TestBed.inject(RideUploader);
    http = TestBed.inject(HttpTestingController);
  });

  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('posts queued blocks in order and empties the queue', async () => {
    await uploader.enqueue({ rideId: 'r1', kind: 'samples', body: BLOCK });
    await settle();
    http
      .expectOne({ method: 'POST', url: '/api/rides/r1/samples' })
      .flush(null, { status: 204, statusText: '' });
    await settle();
    expect(await store.all()).toEqual([]);
    expect(uploader.pending()).toBe(0);
  });

  it('keeps blocks when offline and sends them later', async () => {
    vi.useFakeTimers();
    try {
      await uploader.enqueue({ rideId: 'r1', kind: 'samples', body: BLOCK });
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne('/api/rides/r1/samples').error(new ProgressEvent('error'), { status: 0 });
      await vi.advanceTimersByTimeAsync(0);
      expect(uploader.offline()).toBe(true);
      expect((await store.all()).length).toBe(1);

      await uploader.enqueue({ rideId: 'r1', kind: 'events', body: [] });
      await vi.advanceTimersByTimeAsync(0);
      // The retry sends the oldest block first.
      http.expectOne('/api/rides/r1/samples').flush(null, { status: 204, statusText: '' });
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne('/api/rides/r1/events').flush(null, { status: 204, statusText: '' });
      await vi.advanceTimersByTimeAsync(0);
      expect(uploader.offline()).toBe(false);
      expect(await store.all()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops blocks the backend rejects (ride gone)', async () => {
    await uploader.enqueue({ rideId: 'gone', kind: 'samples', body: BLOCK });
    await settle();
    http.expectOne('/api/rides/gone/samples').flush({}, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(await store.all()).toEqual([]);
  });

  it('completes after flushing, or queues the completion when offline', async () => {
    const done = uploader.complete('r1');
    await settle();
    http.expectOne('/api/rides/r1/complete').flush({ ride: { id: 'r1' }, events: [] });
    expect((await done)?.ride.id).toBe('r1');

    const later = uploader.complete('r2');
    await settle();
    http.expectOne('/api/rides/r2/complete').error(new ProgressEvent('error'), { status: 0 });
    await settle();
    await settle();
    // The queued completion is retried right away (and fails again while offline).
    http
      .match('/api/rides/r2/complete')
      .forEach((r) => r.error(new ProgressEvent('error'), { status: 0 }));
    expect(await later).toBeNull();
    expect((await store.all()).map((i) => i.kind)).toEqual(['complete']);
  });
});
