import { Injectable, computed, inject, signal } from '@angular/core';
import { DeviceManager } from './device-manager.service';

export type DeviceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Connection state of the trainer and HR strap shown in the top bar: the real Bluetooth device when there is one,
 * otherwise the simulator while a simulated ride is running.
 */
@Injectable({ providedIn: 'root' })
export class DeviceStatusService {
  private readonly manager = inject(DeviceManager);
  readonly simulatedTrainer = signal(false);
  readonly simulatedHeartRate = signal(false);

  readonly trainer = computed<DeviceStatus>(
    () =>
      this.manager.trainer()?.status() ?? (this.simulatedTrainer() ? 'connected' : 'disconnected'),
  );
  readonly heartRate = computed<DeviceStatus>(
    () =>
      this.manager.heartRate()?.status() ??
      (this.simulatedHeartRate() ? 'connected' : 'disconnected'),
  );
  readonly trainerName = computed(() => this.manager.trainer()?.name ?? null);
  readonly heartRateName = computed(() => this.manager.heartRate()?.name ?? null);
}
