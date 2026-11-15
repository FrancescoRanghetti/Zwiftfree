import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, DestroyRef, Injector, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { DeviceStatusService } from '../../devices/device-status.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { DeviceIndicator } from './device-indicator';
import { NAV_ITEMS } from './nav-items';

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    TranslatePipe,
    DeviceIndicator,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly navItems = NAV_ITEMS;
  protected readonly devices = inject(DeviceStatusService);
  protected readonly auth = inject(AuthService);
  constructor() {
    // Ride blocks recorded while offline (or before the tab was closed) are sent as soon as the app opens.
    // Loaded lazily to keep the upload code out of the initial bundle.
    const injector = inject(Injector);
    let alive = true;
    inject(DestroyRef).onDestroy(() => (alive = false));
    void import('../ride/ride-uploader.service').then((m) => {
      if (alive) void injector.get(m.RideUploader).flush();
    });
  }

  protected readonly isHandset = toSignal(
    inject(BreakpointObserver)
      .observe([Breakpoints.XSmall, Breakpoints.Small])
      .pipe(map((r) => r.matches)),
    { initialValue: false },
  );
}
