import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import { RideEvent, SamplesColumns } from '../../core/api/rides.models';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatDuration } from '../../shared/format';

/** Power, heart rate, cadence, speed and elevation over the ride time, with events marked on the timeline. */
@Component({
  selector: 'app-ride-chart',
  imports: [NgxEchartsDirective],
  providers: [
    provideEchartsCore({
      echarts: () => import('../../shared/elevation-profile/echarts-setup').then((m) => m.default),
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div echarts class="chart" [options]="options()" [autoResize]="true"></div>`,
  styles: `
    :host {
      display: block;
      height: 340px;
    }
    .chart {
      width: 100%;
      height: 100%;
    }
  `,
})
export class RideChart {
  readonly samples = input.required<SamplesColumns>();
  readonly events = input<RideEvent[]>([]);
  private readonly i18n = inject(I18nService);

  protected readonly options = computed<EChartsCoreOption>(() => {
    const s = this.samples();
    const t = (k: string) => this.i18n.t(`summary.series.${k}`);
    const pair = (values: (number | null)[]) => s.t.map((x, i) => [x, values[i]]);
    const marks = this.events().map((e) => ({
      xAxis: e.t,
      name: this.i18n.t(`summary.eventTypes.${e.type}`),
    }));
    const line = (name: string, data: (number | null)[][], color: string, yAxisIndex: number) => ({
      name,
      type: 'line',
      data,
      yAxisIndex,
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1.5, color },
      itemStyle: { color },
    });
    return {
      animation: false,
      legend: { textStyle: { color: '#ddd' }, top: 0 },
      grid: { left: 48, right: 56, top: 32, bottom: 56 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number | null) =>
          v === null || v === undefined ? '–' : String(Math.round(v)),
      },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
      xAxis: {
        type: 'value',
        min: 0,
        max: s.t.length ? s.t[s.t.length - 1] : 1,
        axisLabel: { color: '#aaa', formatter: (v: number) => formatDuration(v) },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: 'W · bpm · rpm',
          nameTextStyle: { color: '#aaa' },
          axisLabel: { color: '#aaa' },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        },
        {
          type: 'value',
          name: 'm',
          scale: true,
          nameTextStyle: { color: '#aaa' },
          axisLabel: { color: '#aaa' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          ...line(t('ele'), pair(s.ele), '#8d6e63', 1),
          areaStyle: { opacity: 0.25 },
          markLine: marks.length
            ? {
                silent: true,
                symbol: 'none',
                label: { formatter: '{b}', color: '#eee', fontSize: 10 },
                lineStyle: { color: '#ffeb3b', type: 'dashed' },
                data: marks,
              }
            : undefined,
        },
        line(t('power'), pair(s.power), '#ff9800', 0),
        line(t('hr'), pair(s.hr), '#ef5350', 0),
        line(t('cadence'), pair(s.cadence), '#42a5f5', 0),
        line(t('speed'), pair(s.speedKmh), '#66bb6a', 0),
      ],
    };
  });
}
