import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import { Coord3 } from '../../core/api/roads.models';
import { RidesApi } from '../../core/api/rides.api';
import { problemMessage } from '../../core/api/problem';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatKm, formatM } from '../../shared/grade';
import { TicinoMap } from '../../shared/map/ticino-map';
import { SEGMENT_PREFIX } from '../../core/api/stats.models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatDuration, formatRecordValue } from '../../shared/format';
import {
  HR_ZONE_BAR_COLORS,
  POWER_ZONE_COLORS,
  POWER_ZONE_LIMITS,
  hrZone,
  maxHr,
  powerZone,
  timeInZones,
} from '../../shared/zones';
import { fileNameFrom, saveBlob } from '../../shared/download';
import { ZonesChart } from '../stats/stats-charts';
import { RideChart } from './ride-chart';

/** Summary of one ride: totals, track on the map, charts over time and events. */
@Component({
  selector: 'app-ride-summary-page',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslatePipe,
    TicinoMap,
    RideChart,
    ZonesChart,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <a mat-button routerLink="/history">
        <mat-icon fontSet="material-symbols-outlined">arrow_back</mat-icon>{{ 'summary.back' | t }}
      </a>
      @if (data.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (data.error()) {
        <p class="error" role="alert">{{ errorText() }}</p>
      }
      @if (data.hasValue()) {
        @let r = data.value().detail.ride;
        <header class="head">
          <div>
            <h1>{{ r.routeName ?? ('history.freeRide' | t) }}</h1>
            <p class="muted">
              {{ r.startedAt | date: 'EEEE d MMMM y, HH:mm' }} ·
              {{ 'history.statuses.' + r.status | t }}
            </p>
          </div>
          <div class="actions">
            @for (f of formats; track f) {
              <button
                mat-stroked-button
                type="button"
                [disabled]="downloading() !== null"
                [matTooltip]="'summary.exportHelp' | t"
                (click)="download(f)"
                [attr.data-testid]="'export-' + f"
              >
                <mat-icon fontSet="material-symbols-outlined">download</mat-icon>
                {{ (f === 'fit' ? 'summary.exportFit' : 'summary.exportGpx') | t }}
              </button>
            }
            <button
              mat-stroked-button
              class="danger"
              type="button"
              (click)="remove()"
              data-testid="delete-ride"
            >
              <mat-icon fontSet="material-symbols-outlined">delete</mat-icon>
              {{ (confirmDelete() ? 'common.confirm' : 'summary.delete') | t }}
            </button>
          </div>
        </header>
        @if (confirmDelete()) {
          <p class="warn">{{ 'summary.deleteConfirm' | t }}</p>
        }
        @if (r.status === 'IN_PROGRESS') {
          <mat-card appearance="outlined" class="pending">
            <p>{{ 'summary.inProgress' | t }}</p>
            <button mat-flat-button type="button" (click)="complete()" data-testid="complete-ride">
              {{ 'summary.complete' | t }}
            </button>
          </mat-card>
        }

        <div class="stats" data-testid="ride-stats">
          @for (s of stats(); track s.key) {
            <div class="stat">
              <span class="label">{{ 'summary.' + s.key | t }}</span>
              <span class="value">{{ s.value }}</span>
            </div>
          }
        </div>

        @let d = data.value().detail;
        @if (d.records.length) {
          <h2>{{ 'summary.records' | t }}</h2>
          <ul class="list" data-testid="ride-records">
            @for (rec of d.records; track rec.metric) {
              <li>
                <mat-icon fontSet="material-symbols-outlined" class="gold">trophy</mat-icon>
                <span>{{ recordName(rec.metric) }}</span>
                <strong>{{ value(rec.metric, rec.value) }}</strong>
                <span class="muted">{{
                  rec.previous === null
                    ? ('summary.firstValue' | t)
                    : ('summary.previous' | t: { value: value(rec.metric, rec.previous) })
                }}</span>
              </li>
            }
          </ul>
        }
        @if (d.segmentEfforts.length) {
          <h2>{{ 'summary.segments' | t }}</h2>
          <ul class="list" data-testid="ride-segments">
            @for (e of d.segmentEfforts; track $index) {
              <li>
                <mat-icon fontSet="material-symbols-outlined">{{
                  e.type === 'CLIMB' ? 'landscape' : 'bolt'
                }}</mat-icon>
                <span
                  >{{ e.name }}
                  <small class="muted"
                    >{{ km(e.lengthM) }} km
                    @if (e.avgGrade !== null) {
                      · {{ e.avgGrade.toFixed(1) }}%
                    }
                  </small></span
                >
                <strong>{{ time(e.elapsedS) }}</strong>
                <span [class.gold]="e.personalBest" [class.muted]="!e.personalBest">
                  @if (e.personalBest) {
                    {{ 'summary.personalBest' | t }}
                  } @else {
                    {{ 'summary.rank' | t: { rank: e.rank } }}
                  }
                  @if (e.avgPower !== null) {
                    · {{ e.avgPower }} W
                  }
                </span>
              </li>
            }
          </ul>
        }

        @if (track().length > 1) {
          <app-ticino-map class="map" [route]="track()" [fitRoute]="true" [cooperative]="true" />
        }

        <h2>{{ 'summary.charts' | t }}</h2>
        @if (data.value().samples.t.length > 1) {
          <app-ride-chart [samples]="data.value().samples" [events]="data.value().detail.events" />
        }

        @if (zones(); as z) {
          <h2>{{ 'summary.zones' | t }}</h2>
          <div class="zones">
            @if (z.power) {
              <div>
                <h3>{{ 'summary.powerZones' | t }}</h3>
                <p class="muted small">{{ 'summary.powerZonesHelp' | t: { ftp: z.ftp } }}</p>
                <app-zones-chart
                  [seconds]="z.power"
                  [labels]="powerLabels"
                  [colors]="powerColors"
                  data-testid="power-zones"
                />
              </div>
            }
            @if (z.hr) {
              <div>
                <h3>{{ 'summary.hrZones' | t }}</h3>
                <p class="muted small">{{ 'summary.hrZonesHelp' | t: { max: z.maxHr } }}</p>
                <app-zones-chart
                  [seconds]="z.hr"
                  [labels]="hrLabels"
                  [colors]="hrColors"
                  data-testid="hr-zones"
                />
              </div>
            }
          </div>
        }

        <h2>{{ 'summary.events' | t }}</h2>
        @for (e of data.value().detail.events; track e.id) {
          <p class="event">
            <span class="when">{{ time(e.t) }}</span>
            {{ 'summary.eventTypes.' + e.type | t }}
            @if (e.distanceM !== null) {
              <span class="muted">· {{ e.distanceM / 1000 | number: '1.2-2' }} km</span>
            }
          </p>
        } @empty {
          <p class="muted">{{ 'summary.noEvents' | t }}</p>
        }
      }
    </section>
  `,
  styles: `
    .page {
      padding: 16px;
      max-width: 1100px;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    h1 {
      margin: 8px 0 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .warn {
      color: var(--mat-sys-error);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .pending {
      padding: 12px 16px;
      margin: 12px 0;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
      margin: 16px 0;
    }
    .stat {
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
    }
    .label {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .value {
      font-size: 1.3rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .map {
      height: 360px;
      border-radius: 12px;
      overflow: hidden;
    }
    .event {
      margin: 4px 0;
    }
    .when {
      display: inline-block;
      min-width: 64px;
      font-variant-numeric: tabular-nums;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .list li {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      gap: 10px;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .list strong {
      font-variant-numeric: tabular-nums;
    }
    .gold {
      color: #ffc107;
    }
    .zones {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
      gap: 16px;
    }
    h3 {
      margin: 0;
      font-size: 1rem;
    }
    .small {
      font-size: 0.8rem;
      margin: 2px 0 0;
    }
  `,
})
export class RideSummaryPage {
  readonly id = input.required<string>();
  private readonly api = inject(RidesApi);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  protected readonly confirmDelete = signal(false);
  protected readonly formats = ['fit', 'gpx'] as const;
  protected readonly downloading = signal<'fit' | 'gpx' | null>(null);
  private readonly snack = inject(MatSnackBar);

  protected readonly data = rxResource({
    params: () => this.id(),
    stream: ({ params }) =>
      forkJoin({ detail: this.api.get(params), samples: this.api.samplesOf(params) }),
  });

  protected readonly errorText = computed(() => problemMessage(this.data.error()));

  protected readonly track = computed<Coord3[]>(() => {
    if (!this.data.hasValue()) return [];
    const s = this.data.value().samples;
    const out: Coord3[] = [];
    for (let i = 0; i < s.t.length; i++) {
      const lat = s.lat[i];
      const lon = s.lon[i];
      if (lat !== null && lon !== null) out.push([lon, lat, s.ele[i] ?? 0]);
    }
    return out;
  });

  protected readonly stats = computed(() => {
    if (!this.data.hasValue()) return [];
    const r = this.data.value().detail.ride;
    const n = (v: number | null, unit: string) => (v === null ? '–' : `${v} ${unit}`);
    const rows: { key: string; value: string }[] = [
      { key: 'distance', value: r.distanceM === null ? '–' : `${formatKm(r.distanceM)} km` },
      { key: 'movingTime', value: r.movingTimeS === null ? '–' : formatDuration(r.movingTimeS) },
      { key: 'elapsed', value: r.elapsedTimeS === null ? '–' : formatDuration(r.elapsedTimeS) },
      { key: 'ascent', value: r.ascentM === null ? '–' : `${formatM(r.ascentM)} m` },
      {
        key: 'avgSpeed',
        value: r.avgSpeedKmh === null ? '–' : `${r.avgSpeedKmh.toFixed(1)} km/h`,
      },
      { key: 'avgPower', value: n(r.avgPower, 'W') },
      { key: 'maxPower', value: n(r.maxPower, 'W') },
      { key: 'np', value: n(r.normalizedPower, 'W') },
      { key: 'avgHr', value: n(r.avgHr, 'bpm') },
      { key: 'maxHr', value: n(r.maxHr, 'bpm') },
      { key: 'avgCadence', value: n(r.avgCadence, 'rpm') },
      { key: 'kj', value: n(r.kj === null ? null : Math.round(r.kj), 'kJ') },
      { key: 'tss', value: r.tss === null ? '–' : String(Math.round(r.tss)) },
      { key: 'intensity', value: r.intensityFactor === null ? '–' : r.intensityFactor.toFixed(2) },
      { key: 'peeBreaks', value: String(r.peeBreaks) },
      { key: 'crashes', value: String(r.crashes) },
    ];
    return rows;
  });

  protected readonly powerLabels = POWER_ZONE_COLORS.map((_, i) => {
    const lo = i === 0 ? 0 : Math.round(POWER_ZONE_LIMITS[i - 1] * 100);
    const hi = POWER_ZONE_LIMITS[i];
    return hi === undefined ? `Z${i + 1} > ${lo}%` : `Z${i + 1} ${lo}–${Math.round(hi * 100)}%`;
  });
  protected readonly powerColors = POWER_ZONE_COLORS;
  protected readonly hrLabels = ['Z1 < 60%', 'Z2 60–70%', 'Z3 70–80%', 'Z4 80–90%', 'Z5 > 90%'];
  protected readonly hrColors = HR_ZONE_BAR_COLORS;

  /** Time in power zones (needs an FTP) and heart-rate zones (needs readings), from the 1 Hz samples. */
  protected readonly zones = computed(() => {
    if (!this.data.hasValue()) return null;
    const s = this.data.value().samples;
    const me = this.auth.me();
    const ftp = me?.profile?.ftpWatts ?? 0;
    const max = maxHr(me);
    const power =
      ftp && s.power.some((p) => (p ?? 0) > 0)
        ? timeInZones(s.power, (p) => powerZone(p, ftp), 7)
        : null;
    const hr = s.hr.some((h) => (h ?? 0) > 0) ? timeInZones(s.hr, (h) => hrZone(h, max), 5) : null;
    return power || hr ? { power, hr, ftp, maxHr: max } : null;
  });

  protected recordName(metric: string): string {
    if (metric.startsWith(SEGMENT_PREFIX)) {
      const id = metric.slice(SEGMENT_PREFIX.length);
      const effort = this.data.value()?.detail.segmentEfforts.find((e) => e.segmentId === id);
      return effort?.name ?? this.i18n.t('summary.segments');
    }
    return this.i18n.t(`stats.metrics.${metric}`);
  }

  protected value(metric: string, v: number): string {
    return formatRecordValue(metric, v);
  }

  protected km(m: number): string {
    return formatKm(m);
  }

  protected time(t: number): string {
    return formatDuration(t);
  }

  protected async complete(): Promise<void> {
    await firstValueFrom(this.api.complete(this.id()));
    this.data.reload();
  }

  protected async download(format: 'fit' | 'gpx'): Promise<void> {
    this.downloading.set(format);
    try {
      const res = await firstValueFrom(this.api.export(this.id(), format));
      if (res.body) saveBlob(res.body, fileNameFrom(res, `zwiftfree.${format}`));
    } catch (e) {
      this.snack.open(problemMessage(e, this.i18n.t('summary.exportError')), undefined, {
        duration: 4000,
      });
    } finally {
      this.downloading.set(null);
    }
  }

  protected async remove(): Promise<void> {
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      return;
    }
    await firstValueFrom(this.api.delete(this.id()));
    void this.router.navigate(['/history']);
  }
}
