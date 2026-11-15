import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Coord3, RouteDetail } from '../../core/api/roads.models';
import { AuthService } from '../../core/auth/auth.service';
import { ME } from '../../core/auth/testing';
import { RideIntentService } from '../../core/ride/ride-intent.service';
import { crossroads, line, NODES } from '../../physics/testing';
import { BLUETOOTH } from '../../devices/device-manager.service';
import { fakeFtmsTrainer } from '../../devices/ble/fake-ble';
import { ElevationProfile } from '../../shared/elevation-profile/elevation-profile';
import { RideMap } from './ride-map';
import { RidePage } from './ride-page';
import { RideSession } from './ride-session';
import { LivePosition, LiveService } from '../../core/live/live.service';

@Component({
  selector: 'app-ride-map',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class MapStub {
  readonly followHeading = input(true);
  readonly lockZoom = input(true);
}

@Component({
  selector: 'app-elevation-profile',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProfileStub {
  readonly profile = input<unknown>();
  readonly positionM = input<unknown>();
  readonly highlight = input<unknown>();
}

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Blank {}

const COORDS: Coord3[] = [...line(NODES[1], NODES[2]), ...line(NODES[2], NODES[3]).slice(1)];
const DETAIL: RouteDetail = {
  summary: {
    id: 'r1',
    slug: null,
    name: 'Salitella',
    description: null,
    official: true,
    mine: false,
    isPublic: false,
    lengthM: 200,
    ascentM: 15,
    descentM: 0,
    minEle: 200,
    maxEle: 215,
    maxGrade: 10,
    loop: false,
    profile: null,
    createdAt: '2026-11-15T10:00:00Z',
    preview: [],
  },
  edgeIds: [12, 23],
  directions: [1, 1],
  edgeStartsM: [0, 100.07],
  coordinates: COORDS,
  elevationProfile: [
    [0, 200, 0],
    [100, 205, 5],
    [200, 215, 10],
  ],
  segments: [],
};

/** Fake clock for the ride loop (timers, performance.now, animation frames). */
function useFakeTimers(): void {
  vi.useFakeTimers({
    shouldAdvanceTime: false,
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'Date',
    ],
  });
}

describe('RidePage', () => {
  let http: HttpTestingController;
  /** Web Bluetooth seen by the app (null = unsupported browser); read when DeviceManager is created. */
  let bluetooth: unknown = null;
  /** Records what the ride screen publishes on the live WebSocket. */
  const live = {
    published: [] as LivePosition[],
    held: 0,
    acquire: async () => {
      live.held++;
    },
    release: () => {
      live.held--;
    },
    publish: (p: LivePosition) => live.published.push(p),
  };

  beforeEach(async () => {
    useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [RidePage],
      providers: [
        provideRouter([{ path: 'history/:id', component: Blank }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: BLUETOOTH, useFactory: () => bluetooth },
        { provide: LiveService, useValue: live },
      ],
    })
      .overrideComponent(RidePage, {
        remove: { imports: [RideMap, ElevationProfile] },
        add: { imports: [MapStub, ProfileStub] },
      })
      .compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).setMe(ME);
  });

  afterEach(() => {
    vi.useRealTimers();
    bluetooth = null;
    live.published = [];
    live.held = 0;
  });

  const settle = async () => {
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
  };

  it('shows the chooser without an intent', async () => {
    const fixture = TestBed.createComponent(RidePage);
    TestBed.tick();
    http.expectOne('/api/routes').flush([DETAIL.summary]);
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="ride-chooser"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="choose-route"]').length).toBe(1);
  });

  it('rides a planned route with the simulator, uploads samples and opens the summary', async () => {
    TestBed.inject(RideIntentService).set({ kind: 'route', routeId: 'r1', name: 'Salitella' });
    const fixture = TestBed.createComponent(RidePage);
    TestBed.tick();
    http.expectOne('/api/routes').flush([]);
    http.expectOne('/api/routes/r1').flush(DETAIL);
    await settle();
    http.expectOne((r) => r.url === '/api/roads/area').flush(crossroads());
    http
      .expectOne('/api/places/all')
      .flush([
        { id: 1, name: 'Paesello', kind: 'village', population: null, lat: 46.0015, lon: 9.0 },
      ]);
    await settle();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="preride"]')?.textContent).toContain('Salitella');
    (el.querySelector('[data-testid="start-ride"]') as HTMLButtonElement).click();
    await settle();
    const create = http.expectOne('/api/rides');
    expect(create.request.body).toEqual({ routeId: 'r1', mode: 'SIMULATOR' });
    create.flush({ id: 'ride1', status: 'IN_PROGRESS' });
    await settle();
    http
      .expectOne('/api/stats/records')
      .flush([{ metric: 'BEST_5S', value: 250, rideId: 'old', achievedAt: '', segment: null }]);

    const session = fixture.debugElement.injector.get(RideSession);
    expect(session.phase()).toBe('riding');
    session.simulator.setPower(300);
    await vi.advanceTimersByTimeAsync(5000);
    TestBed.tick();
    expect(session.hud().power3s).toBe(300);
    expect(session.hud().distanceM).toBeGreaterThan(5);
    expect(session.hud().nextPlace?.name).toBe('Paesello');
    expect(el.querySelector('[data-testid="hud-power"]')?.textContent).toContain('300');
    // 300 W for 5 s beats the 250 W record.
    expect(document.body.textContent).toContain('Nuovo record! Miglior 5 s: 300 W');

    // Pause: the clock stops and a PAUSE event is queued.
    session.togglePause();
    await settle();
    const pause = http.expectOne('/api/rides/ride1/events');
    expect(pause.request.body.events[0].type).toBe('PAUSE');
    pause.flush(null, { status: 204, statusText: '' });
    const clock = session.hud().timeS;
    await vi.advanceTimersByTimeAsync(3000);
    expect(session.hud().timeS).toBe(clock);
    session.togglePause();
    await settle();
    http.expectOne('/api/rides/ride1/events').flush(null, { status: 204, statusText: '' });

    // Ride to the end of the route: it finishes by itself.
    const router = TestBed.inject(Router);
    let samples = 0;
    for (let i = 0; i < 120 && session.phase() === 'riding'; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      for (const r of http.match('/api/rides/ride1/samples')) {
        samples += r.request.body.samples.length;
        r.flush(null, { status: 204, statusText: '' });
      }
    }
    await settle();
    for (const r of http.match('/api/rides/ride1/samples')) {
      samples += r.request.body.samples.length;
      expect(r.request.body.edges.length).toBeGreaterThanOrEqual(0);
      r.flush(null, { status: 204, statusText: '' });
    }
    await settle();
    http.expectOne('/api/rides/ride1/complete').flush({ ride: { id: 'ride1' }, events: [] });
    await settle();
    expect(samples).toBeGreaterThan(20);
    expect(router.url).toBe('/history/ride1');
    // The live position went out once a second, and the connection was let go at the end.
    expect(live.published.length).toBeGreaterThan(20);
    expect(live.published[5]).toMatchObject({ routeId: 'r1', power: 300, title: 'Salitella' });
    expect(live.published.at(-1)?.avatarState).toBe('FINISHED');
    expect(live.held).toBe(0);
  });

  it('rides on a Bluetooth FTMS trainer: real power, grade sent to the trainer, 0 W when data stops', async () => {
    const fake = fakeFtmsTrainer();
    bluetooth = {
      requestDevice: async () => fake.device.asBluetoothDevice(),
      getDevices: async () => [],
    };
    TestBed.inject(RideIntentService).set({ kind: 'route', routeId: 'r1', name: 'Salitella' });
    const fixture = TestBed.createComponent(RidePage);
    TestBed.tick();
    http.expectOne('/api/routes').flush([]);
    http.expectOne('/api/routes/r1').flush(DETAIL);
    await settle();
    http.expectOne((r) => r.url === '/api/roads/area').flush(crossroads());
    http.expectOne('/api/places/all').flush([]);
    await settle();
    const el = fixture.nativeElement as HTMLElement;

    // The Bluetooth classes are a lazy chunk loaded from disk: pair on the real clock, then back to the fake one.
    vi.useRealTimers();
    (el.querySelector('[data-testid="pair-trainer"]') as HTMLButtonElement).click();
    for (let i = 0; i < 100 && !el.querySelector('[data-testid="device-trainer"] .name'); i++) {
      await new Promise((r) => setTimeout(r, 10));
      TestBed.tick();
    }
    useFakeTimers();
    expect(el.querySelector('[data-testid="device-trainer"]')?.textContent).toContain(
      'Tacx Neo 2T',
    );
    expect(el.querySelector('.sim-mode')?.textContent).toContain('Tacx Neo 2T');

    (el.querySelector('[data-testid="start-ride"]') as HTMLButtonElement).click();
    await settle();
    const create = http.expectOne('/api/rides');
    expect(create.request.body.mode).toBe('TRAINER');
    create.flush({ id: 'ride2', status: 'IN_PROGRESS' });
    await settle();
    http.expectOne('/api/stats/records').flush([]);
    const session = fixture.debugElement.injector.get(RideSession);
    expect(session.usingSimulator()).toBe(false);
    expect(el.querySelector('[data-testid="trainer-box"]')).not.toBeNull();

    // 260 W, 90 rpm from the trainer, every 250 ms for 2 s
    for (let i = 0; i < 8; i++) {
      fake.bikeData.notify([0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0x04, 0x01]);
      await vi.advanceTimersByTimeAsync(250);
    }
    TestBed.tick();
    expect(session.hud().power3s).toBeGreaterThan(150);
    expect(session.hud().cadence).toBe(90);
    // The route's grade went to the trainer through the FTMS control point (0x11).
    const sims = fake.control.writes.filter((w) => w[0] === 0x11);
    expect(sims.length).toBeGreaterThan(0);
    const grade =
      new DataView(Uint8Array.from(sims[sims.length - 1]).buffer).getInt16(3, true) / 100;
    expect(grade).toBeGreaterThan(2);

    // The trainer stops sending: after 3 s the power drops to 0.
    await vi.advanceTimersByTimeAsync(4000);
    TestBed.tick();
    expect(session.hud().cadence).toBe(0);
    for (const r of http.match(() => true)) r.flush(null, { status: 204, statusText: '' });
  });

  async function startRoute(detail: RouteDetail) {
    TestBed.inject(RideIntentService).set({ kind: 'route', routeId: detail.summary.id, name: 'x' });
    const fixture = TestBed.createComponent(RidePage);
    TestBed.tick();
    http.expectOne('/api/routes').flush([]);
    http.expectOne(`/api/routes/${detail.summary.id}`).flush(detail);
    await settle();
    http.expectOne((r) => r.url === '/api/roads/area').flush([]);
    http.expectOne('/api/places/all').flush([]);
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="start-ride"]') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/rides').flush({ id: 'ride3', status: 'IN_PROGRESS' });
    await settle();
    http.expectOne('/api/stats/records').flush([]);
    return { fixture, el, session: fixture.debugElement.injector.get(RideSession) };
  }

  /**
   * Answers every ride request and returns the events that were posted. The upload queue sends one request at a
   * time, so keep answering until nothing is left.
   */
  async function drainEvents(): Promise<{ type: string; payload?: Record<string, unknown> }[]> {
    const out: { type: string; payload?: Record<string, unknown> }[] = [];
    for (let round = 0; round < 20; round++) {
      const pending = http.match(() => true);
      if (!pending.length) break;
      for (const r of pending) {
        if (r.request.url.endsWith('/events')) out.push(...r.request.body.events);
        r.flush(null, { status: 204, statusText: '' });
      }
      await vi.advanceTimersByTimeAsync(0);
    }
    return out;
  }

  it('takes a pee break after 20 s standing still and shows the timer', async () => {
    const { el, session } = await startRoute(DETAIL);
    session.simulator.setPower(250);
    await vi.advanceTimersByTimeAsync(3000);
    session.simulator.setPower(0);
    const events: string[] = [];
    for (let i = 0; i < 30 && session.hud().state !== 'PEE_BREAK'; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      events.push(...(await drainEvents()).map((e) => e.type));
    }
    TestBed.tick();
    expect(session.hud().state).toBe('PEE_BREAK');
    await vi.advanceTimersByTimeAsync(1000);
    events.push(...(await drainEvents()).map((e) => e.type));
    TestBed.tick();
    expect(events).toContain('PEE_BREAK_START');
    expect(el.querySelector('[data-testid="pee-banner"]')?.textContent).toContain('Pausa pipì 0:0');
    expect(session.trainerGrade()).toBe(0);

    session.simulator.setPower(200);
    await vi.advanceTimersByTimeAsync(1000);
    TestBed.tick();
    expect((await drainEvents()).map((e) => e.type)).toContain('PEE_BREAK_END');
    expect(el.querySelector('[data-testid="pee-banner"]')).toBeNull();
  });

  it('crashes when braking hard on a fast descent, then gets up after pedalling', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25); // braking roll 0.25 < 0.3, penalty 6.25 s
    const descent: Coord3[] = line([9, 46, 400], [9, 46.009, 300], 100);
    const { el, session } = await startRoute({
      ...DETAIL,
      summary: { ...DETAIL.summary, id: 'r2', lengthM: 1000 },
      edgeIds: [1],
      directions: [1],
      edgeStartsM: [0],
      coordinates: descent,
      elevationProfile: [
        [0, 400, 0],
        [1000, 300, -10],
      ],
    });
    session.simulator.setPower(300);
    await vi.advanceTimersByTimeAsync(15000);
    await drainEvents();
    expect(session.hud().speedKmh).toBeGreaterThan(35);
    session.simulator.setPower(0);
    await vi.advanceTimersByTimeAsync(500);
    TestBed.tick();
    expect(session.hud().state).toBe('CRASHED');
    expect(el.querySelector('[data-testid="crash-banner"]')?.textContent).toContain('Sei caduto!');
    expect(session.crashes()).toBe(1);
    expect(session.trainerGrade()).toBe(0);
    const crash = (await drainEvents()).find((e) => e.type === 'CRASH');
    expect(crash?.payload).toMatchObject({ reason: 'HARD_BRAKING', grade: -10 });

    await vi.advanceTimersByTimeAsync(7000);
    TestBed.tick();
    expect(session.hud().state).toBe('RECOVERING');
    expect(el.querySelector('[data-testid="crash-banner"]')?.textContent).toContain(
      'Pedala per rialzarti',
    );
    session.simulator.setPower(200);
    await vi.advanceTimersByTimeAsync(1000);
    TestBed.tick();
    expect(session.hud().state).toBe('RIDING');
    expect((await drainEvents()).map((e) => e.type)).toContain('RECOVERED');
    vi.mocked(Math.random).mockRestore();
  });
});
