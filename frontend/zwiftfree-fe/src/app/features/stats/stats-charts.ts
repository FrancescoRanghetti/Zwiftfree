import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import { CurvePoint, LoadDay } from '../../core/api/stats.models';
import { I18nService } from '../../core/i18n/i18n.service';
import { durationLabel } from '../../shared/format';

const ECHARTS = provideEchartsCore({
  echarts: () => import('../../shared/elevation-profile/echarts-setup').then((m) => m.default),
});

const AXIS = { axisLabel: { color: '#aaa' }, nameTextStyle: { color: '#aaa' } };
const GRID_LINE = { lineStyle: { color: 'rgba(255,255,255,0.08)' } };

/** Monday (yyyy-MM-dd) of the week containing the date. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

interface TooltipParam {
  marker: string;
  seriesName: string;
  value: [string | number, number];
}

/** "15 nov 2026" for a chart timestamp. */
function dayLabel(t: number | string): string {
  return new Date(t).toLocaleDateString('it-CH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Sums daily TSS per week (Monday to Sunday). */
export function weeklyTss(days: LoadDay[]): [string, number][] {
  const weeks = new Map<string, number>();
  for (const d of days) {
    const w = weekStart(d.date);
    weeks.set(w, (weeks.get(w) ?? 0) + d.tss);
  }
  return [...weeks.entries()].map(([w, tss]) => [w, Math.round(tss)]);
}

/** Weekly TSS bars with daily CTL, ATL and TSB lines. */
@Component({
  selector: 'app-load-chart',
  imports: [NgxEchartsDirective],
  providers: [ECHARTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div echarts class="chart" [options]="options()" [autoResize]="true"></div>`,
  styles: `
    :host {
      display: block;
      height: 300px;
    }
    .chart {
      width: 100%;
      height: 100%;
    }
  `,
})
export class LoadChart {
  readonly days = input.required<LoadDay[]>();
  private readonly i18n = inject(I18nService);

  protected readonly options = computed<EChartsCoreOption>(() => {
    const days = this.days();
    const t = (k: string) => this.i18n.t(`stats.${k}`);
    // Each week's bar sits in the middle of the week (Thursday).
    const bars = weeklyTss(days).map(([w, tss]) => {
      const mid = new Date(`${w}T12:00:00Z`);
      mid.setUTCDate(mid.getUTCDate() + 3);
      return [mid.toISOString().slice(0, 10), tss];
    });
    const line = (name: string, key: 'ctl' | 'atl' | 'tsb', color: string) => ({
      name,
      type: 'line',
      yAxisIndex: 1,
      showSymbol: false,
      data: days.map((d) => [d.date, d[key]]),
      lineStyle: { width: 2, color },
      itemStyle: { color },
    });
    return {
      animation: false,
      legend: { textStyle: { color: '#ddd' }, top: 0 },
      grid: { left: 44, right: 44, top: 36, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: TooltipParam[]) => {
          if (!params.length) return '';
          const rows = params.map((p) => `${p.marker} ${p.seriesName}: <b>${p.value[1]}</b>`);
          return [dayLabel(params[0].value[0]), ...rows].join('<br>');
        },
      },
      xAxis: {
        type: 'time',
        ...AXIS,
        axisPointer: { label: { formatter: (p: { value: number }) => dayLabel(p.value) } },
        splitLine: { show: false },
      },
      yAxis: [
        { type: 'value', name: 'TSS', ...AXIS, splitLine: GRID_LINE },
        { type: 'value', ...AXIS, splitLine: { show: false } },
      ],
      series: [
        {
          name: t('weeklyTss'),
          type: 'bar',
          data: bars,
          barMaxWidth: 22,
          itemStyle: { color: 'rgba(255,152,0,0.55)', borderRadius: [4, 4, 0, 0] },
        },
        line(t('ctl'), 'ctl', '#42a5f5'),
        line(t('atl'), 'atl', '#ef5350'),
        line(t('tsb'), 'tsb', '#66bb6a'),
      ],
    };
  });
}

/** Best average power per duration, from 5 s to 60 min. */
@Component({
  selector: 'app-power-curve-chart',
  imports: [NgxEchartsDirective],
  providers: [ECHARTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div echarts class="chart" [options]="options()" [autoResize]="true"></div>`,
  styles: `
    :host {
      display: block;
      height: 280px;
    }
    .chart {
      width: 100%;
      height: 100%;
    }
  `,
})
export class PowerCurveChart {
  readonly points = input.required<CurvePoint[]>();
  readonly ftp = input<number | null>(null);

  protected readonly options = computed<EChartsCoreOption>(() => {
    const pts = this.points();
    const ftp = this.ftp();
    return {
      animation: false,
      grid: { left: 48, right: 16, top: 16, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number | null) => (v === null || v === undefined ? '–' : `${v} W`),
      },
      xAxis: {
        type: 'category',
        data: pts.map((p) => durationLabel(p.durationS)),
        boundaryGap: false,
        ...AXIS,
      },
      yAxis: { type: 'value', name: 'W', ...AXIS, splitLine: GRID_LINE },
      series: [
        {
          type: 'line',
          data: pts.map((p) => p.watts),
          connectNulls: false,
          smooth: true,
          symbolSize: 7,
          lineStyle: { width: 3, color: '#ff9800' },
          itemStyle: { color: '#ff9800' },
          areaStyle: { color: 'rgba(255,152,0,0.18)' },
          markLine: ftp
            ? {
                silent: true,
                symbol: 'none',
                label: { formatter: `FTP ${ftp} W`, color: '#eee', position: 'insideEndTop' },
                lineStyle: { color: '#90caf9', type: 'dashed' },
                data: [{ yAxis: ftp }],
              }
            : undefined,
        },
      ],
    };
  });
}

/** Horizontal bars: time spent in each zone. */
@Component({
  selector: 'app-zones-chart',
  imports: [NgxEchartsDirective],
  providers: [ECHARTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div echarts class="chart" [options]="options()" [autoResize]="true"></div>`,
  styles: `
    :host {
      display: block;
      height: 220px;
    }
    .chart {
      width: 100%;
      height: 100%;
    }
  `,
})
export class ZonesChart {
  /** seconds per zone, zone 1 first */
  readonly seconds = input.required<number[]>();
  readonly labels = input.required<string[]>();
  readonly colors = input.required<string[]>();

  protected readonly options = computed<EChartsCoreOption>(() => {
    const secs = this.seconds();
    const total = secs.reduce((a, b) => a + b, 0) || 1;
    const colors = this.colors();
    return {
      animation: false,
      grid: { left: 110, right: 56, top: 8, bottom: 8 },
      xAxis: { type: 'value', show: false, max: 100 },
      yAxis: {
        type: 'category',
        inverse: true,
        data: this.labels(),
        axisLabel: { color: '#ddd' },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 18,
          data: secs.map((s, i) => ({
            value: Math.round((s / total) * 1000) / 10,
            itemStyle: { color: colors[i], borderRadius: 4 },
          })),
          label: { show: true, position: 'right', color: '#ddd', formatter: '{c}%' },
        },
      ],
    };
  });
}
