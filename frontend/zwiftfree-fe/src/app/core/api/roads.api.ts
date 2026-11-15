import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CreateRoute,
  LatLon,
  Nearest,
  Place,
  PlanProfile,
  RoadEdge,
  PlanResult,
  RouteDetail,
  RouteSummary,
} from './roads.models';

@Injectable({ providedIn: 'root' })
export class RoadsApi {
  private readonly http = inject(HttpClient);

  plan(waypoints: LatLon[], profile: PlanProfile, loop: boolean): Observable<PlanResult> {
    return this.http.post<PlanResult>('/api/roads/plan', { waypoints, profile, loop });
  }

  nearest(p: LatLon): Observable<Nearest> {
    return this.http.get<Nearest>('/api/roads/nearest', {
      params: new HttpParams().set('lat', p.lat).set('lon', p.lon),
    });
  }

  area(p: LatLon, radiusM: number): Observable<RoadEdge[]> {
    return this.http.get<RoadEdge[]>('/api/roads/area', {
      params: new HttpParams().set('lat', p.lat).set('lon', p.lon).set('radius', radiusM),
    });
  }

  allPlaces(): Observable<Place[]> {
    return this.http.get<Place[]>('/api/places/all');
  }

  places(q: string, limit = 8): Observable<Place[]> {
    return this.http.get<Place[]>('/api/places', {
      params: new HttpParams().set('q', q).set('limit', limit),
    });
  }
}

@Injectable({ providedIn: 'root' })
export class RoutesApi {
  private readonly http = inject(HttpClient);

  list(): Observable<RouteSummary[]> {
    return this.http.get<RouteSummary[]>('/api/routes');
  }

  get(id: string): Observable<RouteDetail> {
    return this.http.get<RouteDetail>(`/api/routes/${encodeURIComponent(id)}`);
  }

  create(route: CreateRoute): Observable<RouteDetail> {
    return this.http.post<RouteDetail>('/api/routes', route);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/routes/${encodeURIComponent(id)}`);
  }
}
