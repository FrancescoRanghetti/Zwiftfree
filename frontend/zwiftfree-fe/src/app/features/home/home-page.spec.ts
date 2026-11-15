import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HomePage } from './home-page';

describe('HomePage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const WEEK = {
    period: 'WEEK',
    from: '2026-11-09T23:00:00Z',
    rides: 3,
    distanceM: 61234,
    movingTimeS: 7384,
    ascentM: 812,
    kj: 1500,
    tss: 160,
    peeBreaks: 1,
    crashes: 0,
    ceneri: 1,
    lastRide: {
      id: 'ride9',
      routeName: 'Lugano – Monte Brè',
      startedAt: '2026-11-14T17:00:00Z',
      distanceM: 20500,
      movingTimeS: 2700,
      ascentM: 420,
    },
  };

  /** Answers the summary request (the page shows totals above the cards). */
  function flushWeek(body: object = WEEK): void {
    http.expectOne((r) => r.url === '/api/stats/summary').flush(body);
  }

  it('shows the six main cards', async () => {
    const fixture = TestBed.createComponent(HomePage);
    TestBed.tick();
    http.expectOne('/api/health').flush({ status: 'UP', version: '0.1.0', database: 'UP' });
    flushWeek({ ...WEEK, rides: 0, lastRide: null });
    await fixture.whenStable();
    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.grid mat-card');
    expect(cards.length).toBe(6);
    expect(cards[0].textContent).toContain('Pedala');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Nessuna uscita ancora');
  });

  it("shows this week's totals and the last ride", async () => {
    const fixture = TestBed.createComponent(HomePage);
    TestBed.tick();
    http.expectOne('/api/health').flush({ status: 'UP', version: '0.1.0', database: 'UP' });
    const req = http.expectOne((r) => r.url === '/api/stats/summary');
    expect(req.request.params.get('period')).toBe('week');
    req.flush(WEEK);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="week-totals"]')?.textContent).toContain(
      '3 uscite · 61.2 km · 2:03:04 · +812 m',
    );
    const last = el.querySelector('[data-testid="last-ride"]') as HTMLAnchorElement;
    expect(last.textContent).toContain('Lugano – Monte Brè');
    expect(last.getAttribute('href')).toBe('/history/ride9');
  });

  it('reports the server as online when /api/health answers', async () => {
    const fixture = TestBed.createComponent(HomePage);
    TestBed.tick();
    http.expectOne('/api/health').flush({ status: 'UP', version: '0.1.0', database: 'UP' });
    flushWeek();
    await fixture.whenStable();
    const status = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="server-status"]',
    );
    expect(status?.textContent).toContain('online');
    expect(status?.textContent).toContain('v0.1.0');
  });

  it('reports the server as unreachable on error', async () => {
    const fixture = TestBed.createComponent(HomePage);
    TestBed.tick();
    http.expectOne('/api/health').flush('down', { status: 502, statusText: 'Bad Gateway' });
    flushWeek();
    await fixture.whenStable();
    const status = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="server-status"]',
    );
    expect(status?.textContent).toContain('non raggiungibile');
  });
});
