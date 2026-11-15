import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import type { BleDevice } from './ble/ble-device';
import type { FecTrainer } from './ble/fec-trainer';
import type { FtmsTrainer } from './ble/ftms-trainer';
import type { HeartRateMonitor } from './ble/heart-rate-monitor';
import { KnownDevice, KnownDevicesService } from './known-devices.service';
import { TrainerDevice } from './trainer';

/** `navigator.bluetooth`, or null where Web Bluetooth is missing (Safari, Firefox, iOS, insecure origins). */
export const BLUETOOTH = new InjectionToken<Bluetooth | null>('BLUETOOTH', {
  providedIn: 'root',
  factory: () => (typeof navigator !== 'undefined' && navigator.bluetooth) || null,
});

export type BleTrainer = (FtmsTrainer | FecTrainer) & TrainerDevice;

// Service ids repeated here so that the protocol code is only loaded when a device is connected.
const FTMS_SERVICE = 0x1826;
const FEC_SERVICE = '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e';
const HR_SERVICE = 0x180d;

/**
 * Connects to FTMS first; only a trainer without FTMS is driven through FE-C (older Tacx), as the spec asks.
 */
export async function connectTrainer(device: BluetoothDevice): Promise<BleTrainer> {
  const server = await device.gatt!.connect();
  let ftms = true;
  try {
    await server.getPrimaryService(FTMS_SERVICE);
  } catch {
    ftms = false;
  }
  const trainer = ftms
    ? new (await import('./ble/ftms-trainer')).FtmsTrainer(device)
    : new (await import('./ble/fec-trainer')).FecTrainer(device);
  await trainer.connect();
  return trainer;
}

/** The real Bluetooth trainer and heart-rate strap of this browser session (the simulator lives in the ride). */
@Injectable({ providedIn: 'root' })
export class DeviceManager {
  private readonly bluetooth = inject(BLUETOOTH);
  private readonly known = inject(KnownDevicesService);

  readonly supported = this.bluetooth !== null;
  /** Re-connecting a remembered device without the chooser needs `getDevices()` (Chrome). */
  readonly canReconnect = typeof this.bluetooth?.getDevices === 'function';
  readonly trainer = signal<BleTrainer | null>(null);
  readonly heartRate = signal<HeartRateMonitor | null>(null);
  readonly busy = signal<'trainer' | 'heartRate' | null>(null);

  /** Opens the browser's device chooser (must run from a click). */
  async pairTrainer(): Promise<BleTrainer> {
    const device = await this.requireBluetooth().requestDevice({
      filters: [{ services: [FTMS_SERVICE] }, { services: [FEC_SERVICE] }, { namePrefix: 'Tacx' }],
      optionalServices: [FTMS_SERVICE, FEC_SERVICE],
    });
    return this.useTrainer(device);
  }

  async pairHeartRate(): Promise<HeartRateMonitor> {
    const device = await this.requireBluetooth().requestDevice({
      filters: [{ services: [HR_SERVICE] }],
    });
    return this.useHeartRate(device);
  }

  /** Connects a device remembered in this browser, without opening the chooser. */
  async reconnect(k: KnownDevice): Promise<void> {
    const devices = (await this.requireBluetooth().getDevices?.()) ?? [];
    const device = devices.find((d) => d.id === k.id);
    if (!device) throw new Error(`${k.name}: autorizzazione scaduta, collegalo di nuovo`);
    if (k.kind === 'trainer') await this.useTrainer(device);
    else await this.useHeartRate(device);
  }

  async disconnect(kind: 'trainer' | 'heartRate'): Promise<void> {
    const d = kind === 'trainer' ? this.trainer() : this.heartRate();
    await d?.disconnect();
    if (kind === 'trainer') this.trainer.set(null);
    else this.heartRate.set(null);
  }

  /** Removes a remembered device, and the browser permission when the browser supports it. */
  async forget(id: string): Promise<void> {
    for (const kind of ['trainer', 'heartRate'] as const) {
      const d = kind === 'trainer' ? this.trainer() : this.heartRate();
      if (d?.id === id) await this.disconnect(kind);
    }
    this.known.forget(id);
    try {
      const device = (await this.bluetooth?.getDevices?.())?.find((d) => d.id === id);
      await device?.forget?.();
    } catch {
      /* best effort */
    }
  }

  private async useTrainer(device: BluetoothDevice): Promise<BleTrainer> {
    this.busy.set('trainer');
    try {
      await this.trainer()?.disconnect();
      this.trainer.set(null);
      const trainer = await connectTrainer(device);
      this.trainer.set(trainer);
      this.remember(trainer, 'trainer');
      return trainer;
    } finally {
      this.busy.set(null);
    }
  }

  private async useHeartRate(device: BluetoothDevice): Promise<HeartRateMonitor> {
    this.busy.set('heartRate');
    try {
      await this.heartRate()?.disconnect();
      this.heartRate.set(null);
      const { HeartRateMonitor } = await import('./ble/heart-rate-monitor');
      const hrm = new HeartRateMonitor(device);
      await hrm.connect();
      this.heartRate.set(hrm);
      this.remember(hrm, 'heartRate');
      return hrm;
    } finally {
      this.busy.set(null);
    }
  }

  private remember(d: BleDevice, kind: KnownDevice['kind']): void {
    this.known.remember({
      id: d.id,
      name: d.name,
      kind,
      lastConnectedAt: new Date().toISOString(),
    });
  }

  private requireBluetooth(): Bluetooth {
    if (!this.bluetooth)
      throw new Error('Questo browser non supporta Web Bluetooth: usa Chrome o Edge');
    return this.bluetooth;
  }
}
