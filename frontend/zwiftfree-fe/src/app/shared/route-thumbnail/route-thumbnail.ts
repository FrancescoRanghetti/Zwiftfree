import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Lightweight SVG mini-map of a route (no map library), used in route lists. */
@Component({
  selector: 'app-route-thumbnail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 100 70" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect width="100" height="70" rx="6" class="bg" />
      @if (path(); as p) {
        <polyline [attr.points]="p.points" class="track" />
        <circle [attr.cx]="p.start[0]" [attr.cy]="p.start[1]" r="2.6" class="start" />
        <circle [attr.cx]="p.end[0]" [attr.cy]="p.end[1]" r="2.6" class="end" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .bg {
      fill: var(--mat-sys-surface-container-highest);
    }
    .track {
      fill: none;
      stroke: var(--mat-sys-primary);
      stroke-width: 2.2;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .start {
      fill: #43a047;
    }
    .end {
      fill: #e53935;
    }
  `,
})
export class RouteThumbnail {
  /** [lon, lat] points */
  readonly track = input.required<[number, number][]>();

  protected readonly path = computed(() => projectTrack(this.track(), 100, 70, 8));
}

/** Equirectangular projection scaled to fit the box (longitudes shrunk by cos(latitude)). */
export function projectTrack(
  track: [number, number][],
  width: number,
  height: number,
  margin: number,
): { points: string; start: [number, number]; end: [number, number] } | null {
  if (track.length < 2) return null;
  const lat0 = (track.reduce((s, p) => s + p[1], 0) / track.length) * (Math.PI / 180);
  const xs = track.map((p) => p[0] * Math.cos(lat0));
  const ys = track.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (width - 2 * margin) / Math.max(maxX - minX, 1e-9),
    (height - 2 * margin) / Math.max(maxY - minY, 1e-9),
  );
  const offX = (width - (maxX - minX) * scale) / 2;
  const offY = (height - (maxY - minY) * scale) / 2;
  const pts = xs.map(
    (x, i) =>
      [+(offX + (x - minX) * scale).toFixed(1), +(offY + (maxY - ys[i]) * scale).toFixed(1)] as [
        number,
        number,
      ],
  );
  return {
    points: pts.map((p) => p.join(',')).join(' '),
    start: pts[0],
    end: pts[pts.length - 1],
  };
}
