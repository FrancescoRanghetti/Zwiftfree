import { Injectable, signal } from '@angular/core';
import { PlanResult } from '../api/roads.models';

/** What the rider chose to do before opening the ride screen. */
export type RideIntent =
  | { kind: 'route'; routeId: string; name: string }
  | { kind: 'plan'; plan: PlanResult; name: string }
  | { kind: 'free'; lat: number; lon: number; name: string };

@Injectable({ providedIn: 'root' })
export class RideIntentService {
  private readonly _intent = signal<RideIntent | null>(null);
  readonly intent = this._intent.asReadonly();

  set(intent: RideIntent): void {
    this._intent.set(intent);
  }

  clear(): void {
    this._intent.set(null);
  }
}
