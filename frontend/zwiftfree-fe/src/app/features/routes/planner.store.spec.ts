import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PlannerStore } from './planner.store';

const A = { lat: 46.15, lon: 8.94 };
const B = { lat: 46.14, lon: 8.91 };
const C = { lat: 46.19, lon: 9.02 };

describe('PlannerStore', () => {
  let store: PlannerStore;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [PlannerStore, provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(PlannerStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('orders clicks as start, finish, then intermediate points before the finish', () => {
    store.addPoint(A);
    store.addPoint(B);
    store.addPoint(C);
    expect(store.waypoints()).toEqual([A, C, B]);
    store.reverse();
    expect(store.waypoints()).toEqual([B, C, A]);
    store.removePoint(1);
    expect(store.waypoints()).toEqual([B, A]);
  });

  it('plans (debounced) once there are two points and keeps only the latest answer', async () => {
    store.addPoint(A);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(300);
    http.expectNone('/api/roads/plan');

    store.addPoint(B);
    TestBed.tick();
    store.profile.set('AVOID_CLIMBS');
    TestBed.tick();
    expect(store.loading()).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/roads/plan');
    expect(req.request.body).toEqual({ waypoints: [A, B], profile: 'AVOID_CLIMBS', loop: false });
    req.flush({ lengthM: 5800, coordinates: [] });
    expect(store.result()?.lengthM).toBe(5800);
    expect(store.loading()).toBe(false);
  });

  it('exposes the backend error and clears the result', async () => {
    store.addPoint(A);
    store.addPoint(B);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(300);
    http
      .expectOne('/api/roads/plan')
      .flush(
        { detail: 'Nessuna strada vicino al punto 2' },
        { status: 422, statusText: 'Unprocessable' },
      );
    expect(store.error()).toBe('Nessuna strada vicino al punto 2');
    expect(store.result()).toBeNull();
  });
});
