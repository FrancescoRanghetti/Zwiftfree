import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { RidesApi } from '../../core/api/rides.api';
import { StatsApi } from '../../core/api/stats.api';
import { SEGMENT_PREFIX, StatsPeriod } from '../../core/api/stats.models';
import { AuthService } from '../../core/auth/auth.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatDuration, formatRecordValue } from '../../shared/format';
import { formatKm, formatM } from '../../shared/grade';
import { TicinoMap } from '../../shared/map/ticino-map';
import { LoadChart, PowerCurveChart } from './stats-charts';

/** Totals by period, training load, power curve, personal records and the fun counters. */
@Component({
  selector: 'app-stats-page',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonToggleModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    TranslatePipe,
    TicinoMap,
    LoadChart,
    PowerCurveChart,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <h1>{{ 'nav.stats' | t }}</h1>
        <mat-button-toggle-group
          [value]="period()"
          (change)="period.set($event.value)"
          [attr.aria-label]="'nav.stats' | t"
          data-testid="period"
        >
          @for (p of periods; track p) {
            <mat-button-toggle [value]="p">{{ 'stats.periods.' + p | t }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </header>

      @if (summary.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (summary.hasValue()) {
        @let s = summary.value();
        <div class="totals" data-testid="totals">
          <div class="stat">
            <span class="label">{{ 'stats.rides' | t }}</span><span class="value">{{
              s.rides
            }}</span>
          </div>
          <div class="stat">
            <span class="label">{{ 'stats.distance' | t }}</span><span class="value"
              >{{ km(s.distanceM) }} km</span
            >
          </div>
          <div class="stat">
            <span class="label">{{ 'stats.time' | t }}</span><span class="value">{{
              duration(s.movingTimeS)
            }}</span>
          </div>
          <div class="stat">
            <span class="label">{{ 'stats.ascent' | t }}</span><span class="value"
              >{{ m(s.ascentM) }} m</span
            >
          </div>
          <div class="stat">
            <span class="label">{{ 'stats.kj' | t }}</span><span class="value"
              >{{ m(s.kj) }} kJ</span
            >
          </div>
          <div class="stat">
            <span class="label">{{ 'stats.tss' | t }}</span><span class="value">{{
              m(s.tss)
            }}</span>
          </div>
        </div>

        <h2>{{ 'stats.fun' | t }}</h2>
        <div class="fun" data-testid="fun">
          <div class="counter">
            <span class="emoji" aria-hidden="true">💧</span>
            <span class="value">{{ s.peeBreaks }}</span>
            <span class="label">{{ 'stats.peeBreaks' | t }}</span>
          </div>
          <div class="counter">
            <span class="emoji" aria-hidden="true">🤕</span>
            <span class="value">{{ s.crashes }}</span>
            <span class="label">{{ 'stats.crashes' | t }}</span>
          </div>
          <div class="counter">
            <span class="emoji" aria-hidden="true">⛰️</span>
            <span class="value">{{ s.ceneri }}</span>
            <span class="label">{{ 'stats.ceneri' | t }}</span>
          </div>
          <div class="counter">
            <span class="emoji" aria-hidden="true">🗺️</span>
            <span class="value" data-testid="explored-value">{{
              explored.hasValue() ? percent(explored.value().percent) + '%' : '–'
            }}</span>
            <span class="label">{{ 'stats.explored' | t }}</span>
            @if (explored.hasValue()) {
              <span class="sub">{{
                'stats.exploredDetail'
                  | t: { km: explored.value().exploredKm, total: explored.value().totalKm }
              }}</span>
            }
          </div>
        </div>
      }
      @if (explored.hasValue() && explored.value().exploredEdges > 0) {
        <app-ticino-map
          class="map"
          colorMode="explored"
          [overlay]="explored.value().geojson"
          [fitOverlay]="true"
          [cooperative]="true"
        />
      }

      <div class="grid">
        <mat-card appearance="outlined">
          <mat-card-header>
            <mat-card-title>{{ 'stats.load' | t }}</mat-card-title>
            <mat-card-subtitle>{{ 'stats.loadHelp' | t }}</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            @if (hasLoad()) {
              <app-load-chart [days]="load.value()!" />
            } @else if (!load.isLoading()) {
              <p class="muted">{{ 'stats.noData' | t }}</p>
            }
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined">
          <mat-card-header>
            <mat-card-title>{{ 'stats.powerCurve' | t }}</mat-card-title>
            <mat-card-subtitle>{{ 'stats.powerCurveHelp' | t }}</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            @if (hasCurve()) {
              <app-power-curve-chart [points]="curve.value()!" [ftp]="ftp()" />
            } @else if (!curve.isLoading()) {
              <p class="muted">{{ 'stats.noData' | t }}</p>
            }
          </mat-card-content>
        </mat-card>
      </div>

      <div class="grid">
        <mat-card appearance="outlined">
          <mat-card-header>
            <mat-card-title>{{ 'stats.records' | t }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <ul class="records" data-testid="records">
              @for (r of generalRecords(); track r.metric) {
                <li>
                  <span>{{ 'stats.metrics.' + r.metric | t }}</span>
                  <strong>{{ value(r.metric, r.value) }}</strong>
                  @if (r.rideId) {
                    <a [routerLink]="['/history', r.rideId]" class="muted">{{
                      r.achievedAt | date: 'd MMM y'
                    }}</a>
                  } @else {
                    <span class="muted">{{ r.achievedAt | date: 'd MMM y' }}</span>
                  }
                </li>
              } @empty {
                <li class="muted">{{ 'stats.noData' | t }}</li>
              }
            </ul>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined">
          <mat-card-header>
            <mat-card-title>{{ 'stats.segmentRecords' | t }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <ul class="records" data-testid="segment-records">
              @for (r of segmentRecords(); track r.metric) {
                <li>
                  <span
                    >{{ r.segment!.name }}
                    <small class="muted"
                      >{{ km(r.segment!.lengthM) }} km
                      @if (r.segment!.avgGrade !== null) {
                        · {{ r.segment!.avgGrade!.toFixed(1) }}%
                      }
                    </small></span
                  >
                  <strong>{{ value(r.metric, r.value) }}</strong>
                  @if (r.rideId) {
                    <a [routerLink]="['/history', r.rideId]" class="muted">{{
                      r.achievedAt | date: 'd MMM y'
                    }}</a>
                  } @else {
                    <span class="muted">{{ r.achievedAt | date: 'd MMM y' }}</span>
                  }
                </li>
              } @empty {
                <li class="muted">{{ 'stats.segmentsEmpty' | t }}</li>
              }
            </ul>
          </mat-card-content>
        </mat-card>
      </div>
    </section>
  `,
  styles: `
    .page {
      padding: 16px;
      max-width: 1200px;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    h1 {
      margin: 0;
    }
    h2 {
      margin: 24px 0 8px;
      font-size: 1.1rem;
    }
    .totals {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
      margin: 16px 0 0;
    }
    .stat {
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
    }
    .stat .label {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .stat .value {
      font-size: 1.4rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .fun {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 8px;
    }
    .counter {
      background: var(--mat-sys-surface-container-high);
      border-radius: 16px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .counter .emoji {
      display: block;
      font-size: 1.8rem;
      line-height: 1.3;
    }
    .counter .value {
      display: block;
      line-height: 1.2;
      font-size: 2rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .counter .label {
      color: var(--mat-sys-on-surface-variant);
    }
    .counter .sub {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .map {
      display: block;
      height: 320px;
      margin-top: 12px;
      border-radius: 12px;
      overflow: hidden;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .records {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .records li {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 12px;
      align-items: baseline;
      padding: 6px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .records li:last-child {
      border-bottom: none;
    }
    .records strong {
      font-variant-numeric: tabular-nums;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class StatsPage {
  private readonly stats = inject(StatsApi);
  private readonly rides = inject(RidesApi);
  private readonly auth = inject(AuthService);

  protected readonly periods: StatsPeriod[] = ['week', 'month', 'year', 'all'];
  protected readonly period = signal<StatsPeriod>('week');

  protected readonly summary = rxResource({
    params: () => this.period(),
    stream: ({ params }) => this.stats.summary(params),
  });
  protected readonly curve = rxResource({
    params: () => this.period(),
    stream: ({ params }) => this.stats.powerCurve(params),
  });
  protected readonly load = rxResource({ stream: () => this.stats.trainingLoad() });
  protected readonly records = rxResource({ stream: () => this.stats.records() });
  protected readonly explored = rxResource({ stream: () => this.rides.explored() });

  protected readonly ftp = computed(() => this.auth.me()?.profile?.ftpWatts ?? null);
  protected readonly hasCurve = computed(
    () => this.curve.hasValue() && this.curve.value().some((p) => p.watts !== null),
  );
  protected readonly hasLoad = computed(
    () => this.load.hasValue() && this.load.value().some((d) => d.tss > 0 || d.ctl > 0),
  );
  protected readonly generalRecords = computed(() =>
    this.records.hasValue()
      ? this.records.value().filter((r) => !r.metric.startsWith(SEGMENT_PREFIX))
      : [],
  );
  protected readonly segmentRecords = computed(() =>
    this.records.hasValue() ? this.records.value().filter((r) => r.segment) : [],
  );

  protected km(m: number): string {
    return formatKm(m);
  }

  protected m(v: number): string {
    return formatM(v);
  }

  protected duration(s: number): string {
    return formatDuration(s);
  }

  protected value(metric: string, v: number): string {
    return formatRecordValue(metric, v);
  }

  protected percent(p: number): string {
    return p.toLocaleString('it-CH', { maximumFractionDigits: 2 });
  }
}
