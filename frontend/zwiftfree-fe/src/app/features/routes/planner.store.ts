import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, filter, map, of, switchMap, tap } from 'rxjs';
import { problemMessage } from '../../core/api/problem';
import { RoadsApi } from '../../core/api/roads.api';
import { LatLon, PlanProfile, PlanResult } from '../../core/api/roads.models';

/** Planner state: waypoints, options and the latest plan, recomputed automatically (debounced). */
@Injectable()
export class PlannerStore {
  private readonly api = inject(RoadsApi);

  readonly waypoints = signal<LatLon[]>([]);
  readonly profile = signal<PlanProfile>('SHORTEST');
  readonly loop = signal(false);
  readonly result = signal<PlanResult | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly canPlan = computed(() => this.waypoints().length >= 2);
  private readonly request = computed(() => ({
    waypoints: this.waypoints(),
    profile: this.profile(),
    loop: this.loop(),
  }));

  constructor() {
    toObservable(this.request)
      .pipe(
        tap((r) => {
          if (r.waypoints.length < 2) {
            this.result.set(null);
            this.error.set(null);
            this.loading.set(false);
          }
        }),
        filter((r) => r.waypoints.length >= 2),
        tap(() => this.loading.set(true)),
        debounceTime(250),
        switchMap((r) =>
          this.api.plan(r.waypoints, r.profile, r.loop).pipe(
            map((plan) => ({ plan, error: null as string | null })),
            catchError((e: unknown) => of({ plan: null, error: problemMessage(e) })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ plan, error }) => {
        this.loading.set(false);
        this.result.set(plan);
        this.error.set(error);
      });
  }

  /** 1st click = start, 2nd = finish, further clicks become intermediate points before the finish. */
  addPoint(p: LatLon): void {
    const pts = this.waypoints();
    if (pts.length >= 25) return;
    if (pts.length < 2) this.waypoints.set([...pts, p]);
    else this.waypoints.set([...pts.slice(0, -1), p, pts[pts.length - 1]]);
  }

  movePoint(index: number, p: LatLon): void {
    this.waypoints.update((pts) => pts.map((x, i) => (i === index ? p : x)));
  }

  removePoint(index: number): void {
    this.waypoints.update((pts) => pts.filter((_, i) => i !== index));
  }

  reverse(): void {
    this.waypoints.update((pts) => [...pts].reverse());
  }

  clear(): void {
    this.waypoints.set([]);
  }
}
