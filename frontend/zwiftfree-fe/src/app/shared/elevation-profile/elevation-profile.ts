import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import { ProfilePoint } from '../../core/api/roads.models';
import { gradeColor } from '../grade';

export interface ProfileHighlight {
  startM: number;
  endM: number;
  label?: string;
}

/** Elevation profile coloured by grade (green < 3%, yellow 3–6%, orange 6–9%, red > 9%). */
@Component({
  selector: 'app-elevation-profile',
  imports: [NgxEchartsDirective],
  providers: [
    provideEchartsCore({ echarts: () => import('./echarts-setup').then((m) => m.default) }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div echarts class="chart" [options]="options()" [autoResize]="true"></div>`,
  styles: `
    :host {
      display: block;
      height: 180px;
    }
    .chart {
      width: 100%;
      height: 100%;
    }
  `,
})
export class ElevationProfile {
  readonly profile = input.required<ProfilePoint[]>();
  /** Current rider position in metres (ride screen). */
  readonly positionM = input<number | null>(null);
  /** Distance window to emphasize, e.g. the next 2 km or a segment. */
  readonly highlight = input<ProfileHighlight | null>(null);

  protected readonly options = computed<EChartsCoreOption>(() => {
    const data = this.profile().map(([d, ele, grade]) => [d / 1000, ele, grade]);
    const eles = data.map((p) => p[1]);
    const minEle = eles.length ? Math.min(...eles) : 0;
    const maxEle = eles.length ? Math.max(...eles) : 100;
    const pad = Math.max(20, (maxEle - minEle) * 0.1);
    const pos = this.positionM();
    const hl = this.highlight();
    const pieces = gradePieces(this.profile());
    return {
      animation: false,
      grid: { left: 44, right: 12, top: 12, bottom: 26 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: { data: number[] }[]) => {
          const p = params[0]?.data;
          return p ? `${p[0].toFixed(2)} km · ${Math.round(p[1])} m · ${p[2].toFixed(1)}%` : '';
        },
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: data.length ? data[data.length - 1][0] : 1,
        axisLabel: {
          formatter: (v: number) => `${Number(v.toFixed(2)).toLocaleString('it-CH')} km`,
          color: '#aaa',
          showMaxLabel: false,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: Math.floor((minEle - pad) / 10) * 10,
        max: Math.ceil((maxEle + pad) / 10) * 10,
        axisLabel: { formatter: '{value} m', color: '#aaa' },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      },
      // ECharts colours a line only along an axis: grade classes become distance ranges on x.
      visualMap: {
        show: false,
        dimension: 0,
        seriesIndex: 0,
        pieces,
        outOfRange: { color: '#888' },
      },
      series: [
        {
          type: 'line',
          data,
          showSymbol: false,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.35 },
          markArea: hl
            ? {
                silent: true,
                itemStyle: { color: 'rgba(255,255,255,0.10)' },
                label: { show: !!hl.label, color: '#ddd', position: 'insideTop' },
                data: [
                  [{ xAxis: hl.startM / 1000, name: hl.label ?? '' }, { xAxis: hl.endM / 1000 }],
                ],
              }
            : undefined,
          markLine:
            pos !== null
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: '#fff', width: 2, type: 'solid' },
                  label: { show: false },
                  data: [{ xAxis: pos / 1000 }],
                }
              : undefined,
        },
      ],
    };
  });
}

export interface GradePiece {
  gte: number;
  lt: number;
  color: string;
}

/**
 * Consecutive profile steps with the same grade colour merged into km ranges on the x axis.
 * The colour of a step is the grade of the 50 m leading to that point.
 */
export function gradePieces(profile: ProfilePoint[]): GradePiece[] {
  const pieces: GradePiece[] = [];
  for (let i = 1; i < profile.length; i++) {
    const from = profile[i - 1][0] / 1000;
    const to = profile[i][0] / 1000;
    const color = gradeColor(profile[i][2]);
    const last = pieces[pieces.length - 1];
    if (last && last.color === color) last.lt = to;
    else pieces.push({ gte: from, lt: to, color });
  }
  // Include the final point in the last range.
  if (pieces.length) pieces[pieces.length - 1].lt += 1e-6;
  return pieces;
}
