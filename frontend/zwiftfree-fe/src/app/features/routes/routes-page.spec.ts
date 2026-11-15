import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Coord3, LatLon, ProfilePoint, RouteSummary } from '../../core/api/roads.models';
import { RideIntentService } from '../../core/ride/ride-intent.service';
import { ElevationProfile } from '../../shared/elevation-profile/elevation-profile';
import { TicinoMap } from '../../shared/map/ticino-map';
import { RoutesPage } from './routes-page';

@Component({
  selector: 'app-ticino-map',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class MapStub {
  static last: MapStub;
  readonly colorMode = input<string>();
  readonly route = input<Coord3[] | null>(null);
  readonly waypoints = input<LatLon[]>([]);
  readonly fitRoute = input(true);
  readonly clickMode = input<string>();
  readonly overlay = input<unknown>(null);
  readonly mapClick = output<LatLon>();
  readonly waypointMoved = output<{ index: number; point: LatLon }>();
  constructor() {
    MapStub.last = this;
  }
  flyTo = vi.fn();
}

@Component({
  selector: 'app-elevation-profile',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProfileStub {
  readonly profile = input<ProfilePoint[]>();
  readonly highlight = input<unknown>();
  readonly positionM = input<number | null>(null);
}

const OFFICIAL: RouteSummary = {
  id: 'r1',
  slug: 'cadenazzo-monte-ceneri',
  name: 'Cadenazzo – Monte Ceneri',
  description: 'La salita classica',
  official: true,
  mine: false,
  isPublic: false,
  lengthM: 5800,
  ascentM: 401,
  descentM: 10,
  minEle: 205,
  maxEle: 554,
  maxGrade: 9.4,
  loop: false,
  profile: 'SHORTEST',
  createdAt: '2026-11-15T10:00:00Z',
  preview: [
    [8.94, 46.15],
    [8.91, 46.14],
  ],
};

describe('RoutesPage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await TestBed.configureTestingModule({
      imports: [RoutesPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    })
      .overrideComponent(RoutesPage, {
        remove: { imports: [TicinoMap, ElevationProfile] },
        add: { imports: [MapStub, ProfileStub] },
      })
      .compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.useRealTimers());

  async function create() {
    const fixture = TestBed.createComponent(RoutesPage);
    TestBed.tick();
    http.expectOne('/api/routes').flush([OFFICIAL]);
    TestBed.tick();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('turns two map clicks into a planned route with stats', async () => {
    const { el } = await create();
    expect(el.querySelector('[data-testid="plan-hint"]')).not.toBeNull();
    MapStub.last.mapClick.emit({ lat: 46.1517, lon: 8.9479 });
    MapStub.last.mapClick.emit({ lat: 46.1405, lon: 8.913 });
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/roads/plan');
    expect(req.request.body.profile).toBe('SHORTEST');
    req.flush({
      edgeIds: [1],
      directions: [1],
      edgeStartsM: [0],
      coordinates: [
        [8.9479, 46.1517, 205],
        [8.913, 46.1405, 554],
      ],
      profile: [
        [0, 205, 0],
        [50, 210, 10],
      ],
      lengthM: 5832,
      ascentM: 401,
      descentM: 12,
      minEle: 205,
      maxEle: 554,
      maxGrade: 9.4,
      loop: false,
      roadNames: ['Via Monte Ceneri'],
    });
    TestBed.tick();
    const stats = el.querySelector('[data-testid="plan-stats"]')!.textContent!;
    expect(stats).toMatch(/5[.,]8/);
    expect(stats).toContain('+401');
    expect(MapStub.last.route()).toHaveLength(2);
    expect(MapStub.last.waypoints()).toHaveLength(2);
  });

  it('changing the cost profile re-plans with the new profile', async () => {
    const { el } = await create();
    MapStub.last.mapClick.emit({ lat: 46.15, lon: 8.94 });
    MapStub.last.mapClick.emit({ lat: 46.14, lon: 8.91 });
    await vi.advanceTimersByTimeAsync(300);
    http.expectOne('/api/roads/plan').flush(null, { status: 422, statusText: 'x' });
    TestBed.tick();
    (el.querySelector('[data-testid="profile-AVOID_CLIMBS"] button') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(300);
    expect(http.expectOne('/api/roads/plan').request.body.profile).toBe('AVOID_CLIMBS');
  });

  it('lists saved routes and starts a ride on one', async () => {
    const { fixture, el } = await create();
    fixture.componentInstance['activeTab'].set('saved');
    await fixture.whenStable();
    await vi.advanceTimersByTimeAsync(500);
    await fixture.whenStable();
    const card = el.querySelector('[data-testid="route-r1"]') as HTMLButtonElement;
    expect(card.textContent).toContain('Cadenazzo – Monte Ceneri');
    expect(card.textContent).toContain('Ufficiale');
    card.click();
    TestBed.tick();
    http.expectOne('/api/routes/r1').flush({
      summary: OFFICIAL,
      edgeIds: [1],
      directions: [1],
      edgeStartsM: [0],
      coordinates: [
        [8.94, 46.15, 205],
        [8.91, 46.14, 554],
      ],
      elevationProfile: [[0, 205, 0]],
      segments: [
        {
          id: 's1',
          name: 'Cadenazzo – Monte Ceneri',
          type: 'CLIMB',
          startM: 0,
          endM: 5800,
          lengthM: 5800,
          avgGrade: 6.7,
          ascentM: 390,
        },
      ],
    });
    http.expectOne('/api/routes/r1/leaderboard').flush([
      {
        segmentId: 's1',
        name: 'Cadenazzo – Monte Ceneri',
        type: 'CLIMB',
        startM: 0,
        lengthM: 5800,
        avgGrade: 6.7,
        efforts: [{ rideId: 'ride7', elapsedS: 1290, avgPower: 255, date: '2026-11-01T09:00:00Z' }],
      },
    ]);
    await fixture.whenStable();
    expect(el.textContent).toContain('Segmenti cronometrati');
    const board = el.querySelector('[data-testid="leaderboard"]')!;
    expect(board.textContent).toContain('21:30');
    expect(board.textContent).toContain('255 W');
    expect(board.querySelector('a')?.getAttribute('href')).toBe('/history/ride7');
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el.querySelector('[data-testid="ride-route"]') as HTMLButtonElement).click();
    expect(TestBed.inject(RideIntentService).intent()).toMatchObject({
      kind: 'route',
      routeId: 'r1',
    });
    expect(nav).toHaveBeenCalledWith(['/ride'], { queryParams: { route: 'r1' } });
  });
});
