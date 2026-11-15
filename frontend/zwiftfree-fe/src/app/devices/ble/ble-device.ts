import { signal } from '@angular/core';
import { DeviceStatus } from '../device-status.service';

/** Delays before the 3 automatic reconnection attempts (spec §6). */
export const RECONNECT_DELAYS_MS = [1000, 3000, 6000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A GATT connection with status and automatic reconnection: when the link drops without the user asking, it
 * retries 3 times, then reports 'error'. Subclasses subscribe to their characteristics in `setup`.
 */
export abstract class BleDevice {
  readonly status = signal<DeviceStatus>('disconnected');
  private userDisconnected = false;
  private reconnecting = false;

  constructor(
    readonly device: BluetoothDevice,
    private readonly retryDelays: readonly number[] = RECONNECT_DELAYS_MS,
  ) {
    device.addEventListener('gattserverdisconnected', () => void this.onDropped());
  }

  get name(): string {
    return this.device.name || 'Bluetooth';
  }

  get id(): string {
    return this.device.id;
  }

  async connect(): Promise<void> {
    this.userDisconnected = false;
    this.status.set('connecting');
    try {
      await this.open();
      this.status.set('connected');
    } catch (e) {
      this.status.set('error');
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    this.userDisconnected = true;
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
    this.status.set('disconnected');
  }

  protected abstract setup(server: BluetoothRemoteGATTServer): Promise<void>;

  /** Called after a successful automatic reconnection (e.g. to resend the last grade). */
  protected afterReconnect(): void {
    /* optional */
  }

  private async open(): Promise<void> {
    const gatt = this.device.gatt;
    if (!gatt) throw new Error('GATT non disponibile');
    const server = await gatt.connect();
    await this.setup(server);
  }

  private async onDropped(): Promise<void> {
    if (this.userDisconnected || this.reconnecting) return;
    this.reconnecting = true;
    this.status.set('connecting');
    try {
      for (const delay of this.retryDelays) {
        await sleep(delay);
        if (this.userDisconnected) return;
        try {
          await this.open();
          this.status.set('connected');
          this.afterReconnect();
          return;
        } catch {
          /* next attempt */
        }
      }
      this.status.set('error');
    } finally {
      this.reconnecting = false;
    }
  }
}

/**
 * Spec §6: send the grade at most once per second and only when it changed by more than 0.1 %. The latest value
 * wins: a change arriving too early is sent when the second is over.
 */
export class GradeThrottle {
  private lastSent: number | null = null;
  private lastAt = -Infinity;
  private pending: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: (grade: number) => Promise<void>,
    private readonly minIntervalMs = 1000,
    private readonly minChange = 0.1,
    private readonly now: () => number = () => Date.now(),
  ) {}

  push(grade: number): void {
    if (this.lastSent !== null && Math.abs(grade - this.lastSent) <= this.minChange) {
      this.pending = null;
      return;
    }
    const wait = this.lastAt + this.minIntervalMs - this.now();
    if (wait <= 0) {
      this.fire(grade);
    } else {
      this.pending = grade;
      this.timer ??= setTimeout(() => {
        this.timer = null;
        if (this.pending !== null) this.push(this.pending);
      }, wait);
    }
  }

  /** Sends the last grade again (after a reconnection the trainer forgot it). */
  resend(): void {
    if (this.lastSent !== null) this.fire(this.lastSent);
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.lastSent = null;
    this.lastAt = -Infinity;
  }

  private fire(grade: number): void {
    this.pending = null;
    this.lastSent = grade;
    this.lastAt = this.now();
    this.send(grade).catch((e) => console.warn('Trainer grade not sent', e));
  }
}
