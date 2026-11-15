import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DeviceStatus } from '../../devices/device-status.service';
import { TranslatePipe } from '../i18n/translate.pipe';

@Component({
  selector: 'app-device-indicator',
  imports: [MatIconModule, MatTooltipModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="indicator"
      [class]="status()"
      [matTooltip]="(labelKey() | t) + ': ' + ('devices.status.' + status() | t)"
      [attr.aria-label]="(labelKey() | t) + ': ' + ('devices.status.' + status() | t)"
      role="status"
    >
      <mat-icon fontSet="material-symbols-outlined">{{ icon() }}</mat-icon>
      <span class="dot"></span>
    </span>
  `,
  styles: `
    .indicator {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 0 6px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--dot);
    }
    .disconnected {
      --dot: #757575;
    }
    .connecting {
      --dot: #ffc107;
    }
    .connected {
      --dot: #4caf50;
    }
    .error {
      --dot: #f44336;
    }
  `,
})
export class DeviceIndicator {
  readonly icon = input.required<string>();
  readonly labelKey = input.required<string>();
  readonly status = input.required<DeviceStatus>();
}
