import { Signal } from '@angular/core';
import { Observable } from 'rxjs';
import { DeviceStatus } from './device-status.service';

export interface TrainerData {
  power?: number;
  cadence?: number;
  speedKmh?: number;
}

/** Common interface of smart trainers (spec §6): FTMS, Tacx FE-C (milestone 5) and the simulator. */
export interface TrainerDevice {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly data$: Observable<TrainerData>;
  /** Grade in %, wind in m/s; the physics of the avatar always uses the true grade. */
  setSimulation(gradePercent: number, windMs?: number, crr?: number, cwa?: number): Promise<void>;
  readonly status: Signal<DeviceStatus>;
}

export interface HeartRateDevice {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** beats per minute */
  readonly hr$: Observable<number>;
  readonly status: Signal<DeviceStatus>;
}
