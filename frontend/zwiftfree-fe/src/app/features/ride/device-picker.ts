import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DeviceManager } from '../../devices/device-manager.service';
import { KnownDevice, KnownDevicesService } from '../../devices/known-devices.service';

type Kind = 'trainer' | 'heartRate';

/** Connect / reconnect / disconnect the Bluetooth trainer and heart-rate strap (pre-ride screen). */
@Component({
  selector: 'app-device-picker',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!manager.supported) {
      <p class="note" data-testid="no-bluetooth">{{ 'ride.noBluetooth' | t }}</p>
    }
    @for (row of rows; track row.kind) {
      @let device = row.kind === 'trainer' ? manager.trainer() : manager.heartRate();
      <div class="row" [attr.data-testid]="'device-' + row.kind">
        <mat-icon fontSet="material-symbols-outlined">{{ row.icon }}</mat-icon>
        @if (device) {
          <span class="name">{{ device.name }}</span>
          <span class="status" [class]="device.status()">{{
            'devices.status.' + device.status() | t
          }}</span>
          <button
            mat-icon-button
            type="button"
            (click)="disconnect(row.kind)"
            [matTooltip]="'ride.disconnect' | t"
            [attr.aria-label]="'ride.disconnect' | t"
          >
            <mat-icon fontSet="material-symbols-outlined">link_off</mat-icon>
          </button>
        } @else {
          <button
            mat-stroked-button
            type="button"
            [disabled]="!manager.supported || manager.busy() !== null"
            (click)="pair(row.kind)"
            [attr.data-testid]="'pair-' + row.kind"
          >
            {{ (manager.busy() === row.kind ? 'devices.status.connecting' : row.label) | t }}
          </button>
          @if (manager.canReconnect) {
            @for (k of row.kind === 'trainer' ? knownTrainers() : knownHr(); track k.id) {
              <button
                mat-button
                type="button"
                [disabled]="manager.busy() !== null"
                (click)="reconnect(k)"
              >
                {{ 'ride.reconnectDevice' | t: { name: k.name } }}
              </button>
            }
          }
        }
      </div>
    }
    @if (error(); as e) {
      <p class="error" role="alert">{{ e }}</p>
    }
  `,
  styles: `
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-height: 44px;
    }
    .name {
      font-weight: 600;
    }
    .status {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .status.connected {
      color: #66bb6a;
    }
    .status.error {
      color: var(--mat-sys-error);
    }
    .note {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      color: var(--mat-sys-error);
      font-size: 0.85rem;
    }
  `,
})
export class DevicePicker {
  protected readonly manager = inject(DeviceManager);
  private readonly known = inject(KnownDevicesService);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = [
    { kind: 'trainer' as const, icon: 'pedal_bike', label: 'ride.connectTrainer' },
    { kind: 'heartRate' as const, icon: 'favorite', label: 'ride.connectHr' },
  ];
  protected readonly knownTrainers = computed(() =>
    this.known.devices().filter((d) => d.kind === 'trainer'),
  );
  protected readonly knownHr = computed(() =>
    this.known.devices().filter((d) => d.kind === 'heartRate'),
  );

  protected async pair(kind: Kind): Promise<void> {
    // requestDevice must be the first thing after the click (user gesture).
    await this.run(() =>
      kind === 'trainer' ? this.manager.pairTrainer() : this.manager.pairHeartRate(),
    );
  }

  protected async reconnect(k: KnownDevice): Promise<void> {
    await this.run(() => this.manager.reconnect(k));
  }

  protected async disconnect(kind: Kind): Promise<void> {
    await this.run(() => this.manager.disconnect(kind));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await action();
    } catch (e) {
      // Closing the browser's chooser is not an error.
      if (e instanceof DOMException && e.name === 'NotFoundError' && /cancel/i.test(e.message))
        return;
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
