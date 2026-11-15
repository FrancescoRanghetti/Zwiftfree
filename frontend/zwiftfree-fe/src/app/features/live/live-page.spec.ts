import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LiveRider, LiveService } from '../../core/live/live.service';
import { TicinoMap } from '../../shared/map/ticino-map';
import { LivePage, STALE_AFTER_MS } from './live-page';

@Component({
  selector: 'app-ticino-map',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class MapStub {
  readonly route = input<unknown>();
  readonly fitRoute = input<unknown>();
  flyTo(): void {
    // no map in tests
  }
}

const RIDER: LiveRider = {
  userId: 'u1',
  displayName: 'Giulia',
  routeId: 'r1',
  distanceM: 12345,
  speedKmh: 31.4,
  power: 245,
  cadence: 88,
  hr: 151,
  grade: 4.2,
  lat: 46.15,
  lon: 8.95,
  remainingM: 2500,
  elapsedS: 1805,
  avatarState: 'RIDING',
  road: 'Via Monte Ceneri',
  title: 'Cadenazzo – Monte Ceneri',
  at: '2026-11-15T20:00:00Z',
};

describe('LivePage', () => {
  let handler: ((r: LiveRider) => void) | null;
  const live = {
    status: signal<'idle' | 'connecting' | 'connected' | 'error'>('connected'),
    acquire: vi.fn(async () => undefined),
    onMyPosition: (h: (r: LiveRider) => void) => {
      handler = h;
      return () => (handler = null);
    },
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    handler = null;
    await TestBed.configureTestingModule({
      imports: [LivePage],
      providers: [{ provide: LiveService, useValue: live }],
    })
      .overrideComponent(LivePage, {
        remove: { imports: [TicinoMap] },
        add: { imports: [MapStub] },
      })
      .compileComponents();
  });

  afterEach(() => vi.useRealTimers());

  it('waits for a ride, then shows its numbers live', async () => {
    const fixture = TestBed.createComponent(LivePage);
    TestBed.tick();
    const el = fixture.nativeElement as HTMLElement;
    expect(live.acquire).toHaveBeenCalled();
    expect(el.querySelector('[data-testid="live-waiting"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="live-status"]')?.textContent).toContain(
      'nessuna pedalata',
    );

    handler!(RIDER);
    TestBed.tick();
    expect(el.querySelector('[data-testid="live-power"]')?.textContent).toContain('245');
    const tiles = el.querySelector('[data-testid="live-tiles"]')!.textContent!;
    expect(tiles).toContain('31.4');
    expect(tiles).toContain('151');
    expect(tiles).toContain('12.3');
    expect(tiles).toContain('30:05');
    expect(el.querySelector('[data-testid="live-where"]')?.textContent).toContain(
      'Via Monte Ceneri',
    );
    expect(el.querySelector('[data-testid="live-status"]')?.textContent).toContain('In diretta');
  });

  it('greys out when the ride stops sending, and says when it is over', async () => {
    const fixture = TestBed.createComponent(LivePage);
    TestBed.tick();
    const el = fixture.nativeElement as HTMLElement;
    handler!(RIDER);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(STALE_AFTER_MS + 1500);
    TestBed.tick();
    expect(el.querySelector('[data-testid="live-tiles"]')?.classList).toContain('stale');
    expect(el.querySelector('[data-testid="live-where"]')?.textContent).toContain('Ferma');

    handler!({ ...RIDER, avatarState: 'FINISHED' });
    TestBed.tick();
    expect(el.querySelector('[data-testid="live-where"]')?.textContent).toContain('Conclusa');
  });
});
