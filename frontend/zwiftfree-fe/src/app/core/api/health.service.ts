import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of } from 'rxjs';

export interface Health {
  status: string;
  version: string;
  database: string;
}

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  check(): Observable<Health | null> {
    return this.http.get<Health>('/api/health').pipe(catchError(() => of(null)));
  }
}
