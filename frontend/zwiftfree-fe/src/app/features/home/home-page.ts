import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { HealthService } from '../../core/api/health.service';
import { StatsApi } from '../../core/api/stats.api';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { NAV_ITEMS } from '../../core/layout/nav-items';
import { formatDuration } from '../../shared/format';
import { formatKm, formatM } from '../../shared/grade';

@Component({
  selector: 'app-home-page',
  imports: [DatePipe, MatCardModule, MatIconModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  protected readonly cards = NAV_ITEMS.filter((i) => i.descKey);
  /** undefined = loading, null = unreachable. */
  protected readonly health = toSignal(inject(HealthService).check());
  /** This week's totals and the last ride (any period). */
  private readonly stats = inject(StatsApi);
  protected readonly week = rxResource({ stream: () => this.stats.summary('week') });

  protected km(m: number | null): string {
    return formatKm(m ?? 0);
  }

  protected m(v: number | null): string {
    return formatM(v ?? 0);
  }

  protected duration(s: number | null): string {
    return formatDuration(s ?? 0);
  }
}
