import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Coord3 } from '../../core/api/roads.models';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LiveRider, LiveService } from '../../core/live/live.service';
import { formatDuration } from '../../shared/format';
import { formatKm } from '../../shared/grade';
import { TicinoMap } from '../../shared/map/ticino-map';

/** Without news for this long the ride is considered stopped (closed tab, lost connection). */
export const STALE_AFTER_MS = 5000;
const TRAIL_POINTS = 900;

/**
 * Second screen (spec §10): open it on a phone or tablet next to the trainer, logged in as the same user, and it
 * shows the numbers of the ride running on the other device, live over the WebSocket.
 */
@Component({
  selector: 'app-live-page',
  imports: [MatIconModule, TranslatePipe, TicinoMap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="live">
      <header>
        <h1>{{ 'live.title' | t }}</h1>
        <span class="status" [class]="'status ' + connection()" data-testid="live-status">
          <span class="dot"></span>{{ 'live.status.' + connection() | t }}
        </span>
      </header>

      @if (rider(); as r) {
        <p class="where" data-testid="live-where">
          <strong>{{ r.title || ('history.freeRide' | t) }}</strong>
          @if (r.road) {
            · {{ r.road }}
          }
          <span class="state">{{ stateLabel() }}</span>
        </p>
        <div class="tiles" [class.stale]="stale()" data-testid="live-tiles">
          <div class="tile big power">
            <span class="label">{{ 'live.power' | t }}</span>
            <span class="value" data-testid="live-power">{{ r.power }}<small>W</small></span>
          </div>
          <div class="tile big">
            <span class="label">{{ 'live.speed' | t }}</span>
            <span class="value">{{ r.speedKmh.toFixed(1) }}<small>km/h</small></span>
          </div>
          <div class="tile">
            <span class="label">{{ 'live.hr' | t }}</span>
            <span class="value">{{ r.hr ?? '–' }}<small>bpm</small></span>
          </div>
          <div class="tile">
            <span class="label">{{ 'live.cadence' | t }}</span>
            <span class="value">{{ r.cadence }}<small>rpm</small></span>
          </div>
          <div class="tile">
            <span class="label">{{ 'live.grade' | t }}</span>
            <span class="value">{{ r.grade.toFixed(1) }}<small>%</small></span>
          </div>
          <div class="tile">
            <span class="label">{{ 'live.distance' | t }}</span>
            <span class="value">{{ km(r.distanceM) }}<small>km</small></span>
          </div>
          @if (r.remainingM !== null) {
            <div class="tile">
              <span class="label">{{ 'live.remaining' | t }}</span>
              <span class="value">{{ km(r.remainingM) }}<small>km</small></span>
            </div>
          }
          <div class="tile">
            <span class="label">{{ 'live.time' | t }}</span>
            <span class="value">{{ time(r.elapsedS) }}</span>
          </div>
        </div>
        @if (trail().length > 1) {
          <app-ticino-map class="map" [route]="trail()" [fitRoute]="false" />
        }
      } @else {
        <div class="waiting" data-testid="live-waiting">
          <mat-icon fontSet="material-symbols-outlined">cast</mat-icon>
          <p>{{ 'live.waiting' | t }}</p>
          <p class="muted">{{ 'live.howTo' | t }}</p>
        </div>
      }
    </section>
  `,
  styles: `
    .live {
      padding: 16px;
      max-width: 1100px;
      margin: 0 auto;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    h1 {
      margin: 0;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-on-surface-variant);
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #9e9e9e;
    }
    .status.connected .dot {
      background: #42a5f5;
    }
    .status.riding .dot {
      background: #66bb6a;
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.35;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .status.riding .dot {
        animation: none;
      }
    }
    .status.connecting .dot {
      background: #ffa726;
    }
    .status.error .dot {
      background: #ef5350;
    }
    .where {
      font-size: 1.1rem;
      margin: 12px 0;
    }
    .state {
      margin-left: 8px;
      padding: 2px 10px;
      border-radius: 12px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font-size: 0.85rem;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 10px;
      transition: opacity 200ms;
    }
    .tiles.stale {
      opacity: 0.45;
    }
    .tile {
      background: var(--mat-sys-surface-container);
      border-radius: 16px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
    }
    .tile.big {
      grid-column: span 2;
    }
    .label {
      display: block;
      line-height: 1.4;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .value {
      display: block;
      line-height: 1.15;
      font-size: 2.2rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .big .value {
      font-size: 3.6rem;
    }
    .power .value {
      color: #ffb74d;
    }
    small {
      font-size: 0.45em;
      font-weight: 500;
      margin-left: 4px;
      color: var(--mat-sys-on-surface-variant);
    }
    .map {
      display: block;
      height: 300px;
      margin-top: 12px;
      border-radius: 16px;
      overflow: hidden;
    }
    .waiting {
      text-align: center;
      padding: 64px 16px;
    }
    .waiting mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: var(--mat-sys-primary);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    @media (max-width: 420px) {
      .tile.big {
        grid-column: span 1;
      }
      .big .value {
        font-size: 2.6rem;
      }
    }
  `,
})
export class LivePage {
  private readonly live = inject(LiveService);
  private readonly translate = inject(I18nService);
  private readonly map = viewChild(TicinoMap);
  private readonly now = signal(Date.now());
  private readonly lastAt = signal(0);
  private wakeLock: { release(): Promise<void> } | null = null;

  protected readonly rider = signal<LiveRider | null>(null);
  protected readonly trail = signal<Coord3[]>([]);
  protected readonly stale = computed(() => this.now() - this.lastAt() > STALE_AFTER_MS);
  protected readonly connection = computed(() => {
    const s = this.live.status();
    if (s !== 'connected') return s === 'idle' ? 'connecting' : s;
    return this.rider() && !this.stale() ? 'riding' : 'connected';
  });
  protected readonly stateLabel = computed(() => {
    const r = this.rider();
    if (!r) return '';
    if (r.avatarState === 'FINISHED') return this.t('live.finished');
    if (this.stale()) return this.t('live.stopped');
    return this.t(`ride.state.${r.avatarState}`);
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    void this.live.acquire(destroyRef).catch(() => undefined);
    const off = this.live.onMyPosition((r) => this.onRider(r));
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    destroyRef.onDestroy(() => {
      off();
      clearInterval(tick);
      void this.wakeLock?.release().catch(() => undefined);
    });
    // Keep the screen on while there is something to show.
    effect(() => {
      if (this.rider() && !this.wakeLock) void this.keepAwake();
    });
  }

  private onRider(r: LiveRider): void {
    const previous = this.rider();
    // A new ride (or the same ride restarted from zero) starts a new trail.
    if (previous && r.distanceM + 1 < previous.distanceM) this.trail.set([]);
    this.rider.set(r);
    this.lastAt.set(Date.now());
    this.now.set(Date.now());
    if (r.lat !== null && r.lon !== null) {
      const point: Coord3 = [r.lon, r.lat, 0];
      this.trail.update((t) => [...t.slice(-TRAIL_POINTS + 1), point]);
      this.map()?.flyTo({ lat: r.lat, lon: r.lon }, 15);
    }
  }

  private async keepAwake(): Promise<void> {
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    try {
      this.wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      this.wakeLock = null;
    }
  }

  private t(key: string): string {
    return this.translate.t(key);
  }

  protected km(m: number): string {
    return formatKm(m);
  }

  protected time(s: number): string {
    return formatDuration(s);
  }
}
