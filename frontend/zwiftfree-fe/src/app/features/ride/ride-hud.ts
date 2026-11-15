import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatKm, gradeColor } from '../../shared/grade';
import { Hud, formatDuration } from './ride-session';

export const HR_ZONE_COLORS = ['#9e9e9e', '#9e9e9e', '#42a5f5', '#66bb6a', '#ffa726', '#ef5350'];

/** Live numbers on top of the ride map. */
@Component({
  selector: 'app-ride-hud',
  imports: [DecimalPipe, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let h = hud();
    <div class="tiles" data-testid="hud">
      <div class="tile main">
        <span class="label">{{ 'hud.power' | t }}</span>
        <span class="value" data-testid="hud-power">{{ h.power3s }}<small>W</small></span>
        <span class="sub">{{ h.wkg | number: '1.1-1' }} W/kg</span>
      </div>
      <div class="tile main">
        <span class="label">{{ 'hud.speed' | t }}</span>
        <span class="value" data-testid="hud-speed"
          >{{ h.speedKmh | number: '1.1-1' }}<small>km/h</small></span
        >
      </div>
      <div class="tile">
        <span class="label">{{ 'hud.grade' | t }}</span>
        <span class="value" [style.color]="gradeColor()" data-testid="hud-grade"
          >{{ h.grade | number: '1.1-1' }}<small>%</small></span
        >
      </div>
      <div class="tile">
        <span class="label">{{ 'hud.cadence' | t }}</span>
        <span class="value">{{ h.cadence }}<small>rpm</small></span>
      </div>
      <div class="tile">
        <span class="label">{{ 'hud.heartRate' | t }}</span>
        <span class="value" [style.color]="hrColor()">{{ h.hr ?? '–' }}<small>bpm</small></span>
        @if (h.hrZone) {
          <span class="sub">Z{{ h.hrZone }}</span>
        }
      </div>
      <div class="tile">
        <span class="label">{{ 'hud.distance' | t }}</span>
        <span class="value" data-testid="hud-distance"
          >{{ h.distanceM / 1000 | number: '1.2-2' }}<small>km</small></span
        >
        @if (h.remainingM !== null) {
          <span class="sub">{{ 'hud.toGo' | t: { km: toGo() } }}</span>
        }
      </div>
      <div class="tile">
        <span class="label">{{ 'hud.ascent' | t }}</span>
        <span class="value">{{ h.ascentM | number: '1.0-0' }}<small>m</small></span>
      </div>
      <div class="tile">
        <span class="label">{{ 'hud.time' | t }}</span>
        <span class="value" data-testid="hud-time">{{ time() }}</span>
      </div>
      <div class="tile">
        <span class="label">NP</span>
        <span class="value">{{ h.np ?? '–' }}<small>W</small></span>
      </div>
    </div>
  `,
  styles: `
    .tiles {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
    }
    .tile {
      background: rgba(18, 18, 18, 0.78);
      border-radius: 10px;
      padding: 6px 10px;
      min-width: 74px;
      display: flex;
      flex-direction: column;
      align-items: center;
      color: #fff;
      backdrop-filter: blur(4px);
    }
    .tile.main {
      min-width: 104px;
    }
    .label {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #bdbdbd;
    }
    .value {
      font-size: 1.35rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .main .value {
      font-size: 1.9rem;
    }
    small {
      font-size: 0.65rem;
      margin-left: 2px;
      color: #bdbdbd;
    }
    .sub {
      font-size: 0.72rem;
      color: #e0e0e0;
    }
    @media (max-width: 600px) {
      .tile {
        min-width: 60px;
        padding: 4px 6px;
      }
      .value {
        font-size: 1.05rem;
      }
      .main .value {
        font-size: 1.4rem;
      }
    }
  `,
})
export class RideHud {
  readonly hud = input.required<Hud>();
  protected readonly time = computed(() => formatDuration(this.hud().timeS));
  protected readonly toGo = computed(() => formatKm(this.hud().remainingM ?? 0));
  protected readonly gradeColor = computed(() => {
    const g = this.hud().grade;
    return g < 0 ? '#81d4fa' : gradeColor(g);
  });
  protected readonly hrColor = computed(() => HR_ZONE_COLORS[this.hud().hrZone] ?? '#fff');
}
