import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Explored,
  Page,
  RideDetail,
  RideEvent,
  RideMode,
  RideSummary,
  SamplesBatch,
  SamplesColumns,
} from './rides.models';

@Injectable({ providedIn: 'root' })
export class RidesApi {
  private readonly http = inject(HttpClient);

  create(routeId: string | null, mode: RideMode): Observable<RideSummary> {
    return this.http.post<RideSummary>('/api/rides', { routeId, mode });
  }

  samples(id: string, batch: SamplesBatch): Observable<void> {
    return this.http.post<void>(`/api/rides/${id}/samples`, batch);
  }

  events(id: string, events: RideEvent[]): Observable<void> {
    return this.http.post<void>(`/api/rides/${id}/events`, { events });
  }

  complete(id: string): Observable<RideDetail> {
    return this.http.post<RideDetail>(`/api/rides/${id}/complete`, {});
  }

  list(page: number, size: number, routeId?: string | null): Observable<Page<RideSummary>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (routeId) params = params.set('routeId', routeId);
    return this.http.get<Page<RideSummary>>('/api/rides', { params });
  }

  get(id: string): Observable<RideDetail> {
    return this.http.get<RideDetail>(`/api/rides/${encodeURIComponent(id)}`);
  }

  samplesOf(id: string): Observable<SamplesColumns> {
    return this.http.get<SamplesColumns>(`/api/rides/${encodeURIComponent(id)}/samples`);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/rides/${encodeURIComponent(id)}`);
  }

  /** The ride as a .fit or .gpx file (with the file name the server suggests). */
  export(id: string, format: 'fit' | 'gpx'): Observable<HttpResponse<Blob>> {
    return this.http.get(`/api/rides/${encodeURIComponent(id)}/export.${format}`, {
      observe: 'response',
      responseType: 'blob',
    });
  }

  explored(): Observable<Explored> {
    return this.http.get<Explored>('/api/me/explored');
  }
}
