import { Injectable, signal } from '@angular/core';

export interface KnownDevice {
  id: string;
  name: string;
  kind: 'trainer' | 'heartRate';
  lastConnectedAt: string;
}

const KEY = 'zf.devices';

/**
 * Bluetooth devices paired in this browser. Web Bluetooth device ids are per-origin and per-browser, so they are
 * stored locally, not on the server. Filled by the device connectors (milestone 5).
 */
@Injectable({ providedIn: 'root' })
export class KnownDevicesService {
  private readonly _devices = signal<KnownDevice[]>(load());
  readonly devices = this._devices.asReadonly();

  remember(device: KnownDevice): void {
    this.save([device, ...this._devices().filter((d) => d.id !== device.id)]);
  }

  forget(id: string): void {
    this.save(this._devices().filter((d) => d.id !== id));
  }

  private save(list: KnownDevice[]): void {
    this._devices.set(list);
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }
}

function load(): KnownDevice[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as KnownDevice[]) : [];
  } catch {
    return [];
  }
}
