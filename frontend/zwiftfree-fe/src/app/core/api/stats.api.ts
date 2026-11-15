import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CurvePoint,
  LoadDay,
  PersonalRecord,
  SegmentBoard,
  StatsPeriod,
  StatsSummary,
} from './stats.models';

@Injectable({ providedIn: 'root' })
export class StatsApi {
  private readonly http = inject(HttpClient);

  summary(period: StatsPeriod): Observable<StatsSummary> {
    return this.http.get<StatsSummary>('/api/stats/summary', { params: { period } });
  }

  powerCurve(period: StatsPeriod): Observable<CurvePoint[]> {
    return this.http.get<CurvePoint[]>('/api/stats/power-curve', { params: { period } });
  }

  /** Dates as yyyy-MM-dd; both optional (default: the last 90 days). */
  trainingLoad(from?: string, to?: string): Observable<LoadDay[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<LoadDay[]>('/api/stats/training-load', { params });
  }

  records(): Observable<PersonalRecord[]> {
    return this.http.get<PersonalRecord[]>('/api/stats/records');
  }

  leaderboard(routeId: string): Observable<SegmentBoard[]> {
    return this.http.get<SegmentBoard[]>(`/api/routes/${encodeURIComponent(routeId)}/leaderboard`);
  }
}
