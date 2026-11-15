import { signal } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, interval } from 'rxjs';
import { Random } from '../shared/random';
import { DeviceStatus } from './device-status.service';
import { HeartRateDevice, TrainerData, TrainerDevice } from './trainer';

export const SIM_MAX_POWER = 600;
export const SIM_STEP_W = 10;

/** Virtual trainer: the rider sets the power with a slider or ↑/↓; cadence wanders between 85 and 95 rpm. */
export class SimulatorTrainer implements TrainerDevice {
  readonly name = 'Simulatore';
  readonly status = signal<DeviceStatus>('disconnected');
  /** Power requested by the rider, W. */
  readonly targetPower = signal(0);
  private readonly data = new BehaviorSubject<TrainerData>({ power: 0, cadence: 0 });
  readonly data$: Observable<TrainerData> = this.data.asObservable();
  /** Last grade sent by the ride (shown in the simulator panel, no effect on the power). */
  readonly grade = signal(0);
  private cadence = 90;
  private sub: Subscription | null = null;

  constructor(
    private readonly random: Random = Math.random,
    private readonly periodMs = 250,
  ) {}

  async connect(): Promise<void> {
    if (this.sub) return;
    this.status.set('connected');
    this.sub = interval(this.periodMs).subscribe(() => this.emit());
    this.emit();
  }

  async disconnect(): Promise<void> {
    this.sub?.unsubscribe();
    this.sub = null;
    this.status.set('disconnected');
  }

  async setSimulation(gradePercent: number): Promise<void> {
    this.grade.set(gradePercent);
  }

  setPower(watts: number): void {
    this.targetPower.set(Math.round(Math.min(SIM_MAX_POWER, Math.max(0, watts))));
    this.emit();
  }

  nudge(deltaW: number): void {
    this.setPower(this.targetPower() + deltaW);
  }

  private emit(): void {
    const power = this.targetPower();
    // Small random walk kept inside 85–95 rpm.
    this.cadence = Math.min(95, Math.max(85, this.cadence + (this.random() - 0.5) * 1.5));
    this.data.next({ power, cadence: power > 0 ? Math.round(this.cadence) : 0 });
  }
}

/** Virtual heart rate that follows the simulated power with a lag (first-order, ~25 s). */
export class SimulatorHeartRate implements HeartRateDevice {
  readonly name = 'Cardio simulato';
  readonly status = signal<DeviceStatus>('disconnected');
  private readonly hr = new BehaviorSubject<number>(0);
  readonly hr$: Observable<number> = this.hr.asObservable();
  private value: number;
  private sub: Subscription | null = null;

  constructor(
    private readonly power: () => number,
    private readonly restingHr = 60,
    private readonly maxHr = 190,
    private readonly ftp = 200,
    private readonly periodMs = 1000,
  ) {
    this.value = restingHr;
  }

  async connect(): Promise<void> {
    if (this.sub) return;
    this.status.set('connected');
    this.sub = interval(this.periodMs).subscribe(() => this.step(this.periodMs / 1000));
    this.hr.next(Math.round(this.value));
  }

  async disconnect(): Promise<void> {
    this.sub?.unsubscribe();
    this.sub = null;
    this.status.set('disconnected');
  }

  /** Steady-state heart rate for a power: resting at 0 W, ~90% of max at FTP, max at 130% FTP. */
  target(powerW: number): number {
    const ratio = Math.min(1.3, Math.max(0, powerW / this.ftp));
    const reserve = this.maxHr - this.restingHr;
    const frac = ratio <= 1 ? ratio * 0.9 : 0.9 + ((ratio - 1) / 0.3) * 0.1;
    return this.restingHr + reserve * frac;
  }

  step(dtS: number): void {
    const tau = 25;
    this.value += (this.target(this.power()) - this.value) * Math.min(1, dtS / tau);
    this.hr.next(Math.round(this.value));
  }
}
