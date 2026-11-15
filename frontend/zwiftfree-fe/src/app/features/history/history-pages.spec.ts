import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RideSummary } from '../../core/api/rides.models';
import { TicinoMap } from '../../shared/map/ticino-map';
import { HistoryPage } from './history-page';
import { ZonesChart } from '../stats/stats-charts';
import { RideChart } from './ride-chart';
import { RideSummaryPage } from './ride-summary-page';

const RIDE: RideSummary = {
  id: 'ride1',
  routeId: null,
  routeName: null,
  startedAt: '2026-11-15T16:47:00Z',
  endedAt: '2026-11-15T16:49:00Z',
  status: 'COMPLETED',
  mode: 'SIMULATOR',
  distanceM: 12345,
  movingTimeS: 1500,
  elapsedTimeS: 1530,
  ascentM: 321,
  avgPower: 210,
  maxPower: 420,
  normalizedPower: 225,
  avgHr: 150,
  maxHr: 178,
  avgCadence: 90,
  avgSpeedKmh: 29.6,
  kj: 315.2,
  tss: 41.3,
  intensityFactor: 0.9,
  peeBreaks: 1,
  crashes: 0,
};

@Component({
  selector: 'app-ticino-map',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class MapStub {
  readonly route = input<unknown>();
  readonly fitRoute = input<unknown>();
  readonly cooperative = input<unknown>();
}

@Component({
  selector: 'app-ride-chart',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ChartStub {
  readonly samples = input<unknown>();
  readonly events = input<unknown>();
}

@Component({
  selector: 'app-zones-chart',
  template: '{{ seconds() }}',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ZonesStub {
  readonly seconds = input<unknown>();
  readonly labels = input<unknown>();
  readonly colors = input<unknown>();
}

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Blank {}

describe('history', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoryPage, RideSummaryPage],
      providers: [
        provideRouter([
          { path: 'history', component: Blank },
          { path: 'history/:id', component: Blank },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    })
      .overrideComponent(RideSummaryPage, {
        remove: { imports: [TicinoMap, RideChart, ZonesChart] },
        add: { imports: [MapStub, ChartStub, ZonesStub] },
      })
      .compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  it('lists rides and opens one', async () => {
    const fixture = TestBed.createComponent(HistoryPage);
    TestBed.tick();
    http.expectOne('/api/routes').flush([]);
    http
      .expectOne((r) => r.url === '/api/rides' && r.params.get('page') === '0')
      .flush({ content: [RIDE], page: 0, size: 20, totalElements: 1, totalPages: 1 });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const row = el.querySelector('[data-testid="ride-row"]') as HTMLElement;
    expect(row.textContent).toContain('Giro libero');
    expect(row.textContent).toContain('12.3 km');
    expect(row.textContent).toContain('25:30');
    expect(row.textContent).toContain('210 W');
    row.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/history/ride1');
  });

  it('shows the summary and deletes after confirmation', async () => {
    const fixture = TestBed.createComponent(RideSummaryPage);
    fixture.componentRef.setInput('id', 'ride1');
    TestBed.tick();
    http.expectOne('/api/rides/ride1').flush({
      ride: RIDE,
      events: [{ id: 'e1', t: 60, type: 'PAUSE', distanceM: 500, payload: null }],
      records: [{ metric: 'BEST_5S', value: 640, previous: 600 }],
      segmentEfforts: [
        {
          segmentId: 's1',
          name: 'Salita del Ceneri',
          type: 'CLIMB',
          lengthM: 5800,
          avgGrade: 6.5,
          elapsedS: 1325,
          avgPower: 250,
          personalBest: true,
          rank: 1,
        },
      ],
    });
    http.expectOne('/api/rides/ride1/samples').flush({
      t: [0, 1],
      distanceM: [0, 8],
      lat: [46.19, 46.1901],
      lon: [9.01, 9.01],
      ele: [230, 231],
      grade: [0, 1],
      power: [200, 210],
      cadence: [90, 91],
      hr: [120, 121],
      speedKmh: [28, 29],
      avatarState: ['RIDING', 'RIDING'],
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const stats = el.querySelector('[data-testid="ride-stats"]')!.textContent!;
    expect(stats).toContain('12.3 km');
    expect(stats).toContain('225 W');
    expect(stats).toContain('0.90');
    expect(el.textContent).toContain('Pausa');
    const records = el.querySelector('[data-testid="ride-records"]')!.textContent!;
    expect(records).toContain('Miglior 5 s');
    expect(records).toContain('640 W');
    expect(records).toContain('prima 600 W');
    const segments = el.querySelector('[data-testid="ride-segments"]')!.textContent!;
    expect(segments).toContain('Salita del Ceneri');
    expect(segments).toContain('22:05');
    expect(segments).toContain('Record personale');
    expect(el.querySelector('[data-testid="hr-zones"]')).not.toBeNull();

    // Export: the file comes from the API (with the token) and is handed to the browser to save.
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const clicked = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    (el.querySelector('[data-testid="export-gpx"]') as HTMLButtonElement).click();
    const exp = http.expectOne('/api/rides/ride1/export.gpx');
    expect(exp.request.responseType).toBe('blob');
    exp.flush(new Blob(['<gpx/>']), {
      headers: {
        'Content-Disposition': 'attachment; filename="zwiftfree-2026-11-15-giro-libero.gpx"',
      },
    });
    await fixture.whenStable();
    expect(created).toHaveBeenCalled();
    expect((clicked.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      'zwiftfree-2026-11-15-giro-libero.gpx',
    );
    created.mockRestore();
    clicked.mockRestore();

    const del = el.querySelector('[data-testid="delete-ride"]') as HTMLButtonElement;
    del.click();
    await fixture.whenStable();
    http.expectNone('/api/rides/ride1');
    del.click();
    await fixture.whenStable();
    http
      .expectOne({ method: 'DELETE', url: '/api/rides/ride1' })
      .flush(null, { status: 204, statusText: '' });
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/history');
  });
});
