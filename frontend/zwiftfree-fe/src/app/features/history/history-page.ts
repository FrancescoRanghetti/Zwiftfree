import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorIntl, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { RoutesApi } from '../../core/api/roads.api';
import { RidesApi } from '../../core/api/rides.api';
import { RideSummary } from '../../core/api/rides.models';
import { AppPaginatorIntl } from '../../core/i18n/paginator-intl';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatKm, formatM } from '../../shared/grade';
import { formatDuration } from '../../shared/format';

/** Paginated list of the rider's rides, newest first, filterable by route. */
@Component({
  selector: 'app-history-page',
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    TranslatePipe,
  ],
  providers: [{ provide: MatPaginatorIntl, useClass: AppPaginatorIntl }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ 'history.title' | t }}</h1>
      <mat-form-field appearance="outline" class="filter">
        <mat-label>{{ 'history.filterRoute' | t }}</mat-label>
        <mat-select
          [value]="routeId() ?? ''"
          (valueChange)="setRoute($event || null)"
          data-testid="route-filter"
        >
          <mat-option value="">{{ 'history.allRoutes' | t }}</mat-option>
          @for (r of routes(); track r.id) {
            <mat-option [value]="r.id">{{ r.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      @if (rides.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (rides.error()) {
        <p class="error">{{ 'history.loadError' | t }}</p>
      }
      @if (rides.hasValue() && !rows().length) {
        <mat-card appearance="outlined" class="empty">
          <p>{{ 'history.empty' | t }}</p>
          <a routerLink="/ride">{{ 'nav.ride' | t }}</a>
        </mat-card>
      }
      @if (rows().length) {
        <div class="table-wrap">
          <table mat-table [dataSource]="rows()" data-testid="rides-table">
            <ng-container matColumnDef="date">
              <th mat-header-cell *matHeaderCellDef>{{ 'history.date' | t }}</th>
              <td mat-cell *matCellDef="let r">{{ r.startedAt | date: 'dd.MM.yyyy HH:mm' }}</td>
            </ng-container>
            <ng-container matColumnDef="route">
              <th mat-header-cell *matHeaderCellDef>{{ 'history.route' | t }}</th>
              <td mat-cell *matCellDef="let r">{{ r.routeName ?? ('history.freeRide' | t) }}</td>
            </ng-container>
            <ng-container matColumnDef="distance">
              <th mat-header-cell *matHeaderCellDef class="num">{{ 'history.distance' | t }}</th>
              <td mat-cell *matCellDef="let r" class="num">{{ km(r) }}</td>
            </ng-container>
            <ng-container matColumnDef="time">
              <th mat-header-cell *matHeaderCellDef class="num">{{ 'history.time' | t }}</th>
              <td mat-cell *matCellDef="let r" class="num">{{ time(r) }}</td>
            </ng-container>
            <ng-container matColumnDef="ascent">
              <th mat-header-cell *matHeaderCellDef class="num">{{ 'history.ascent' | t }}</th>
              <td mat-cell *matCellDef="let r" class="num">{{ ascent(r) }}</td>
            </ng-container>
            <ng-container matColumnDef="power">
              <th mat-header-cell *matHeaderCellDef class="num">{{ 'history.power' | t }}</th>
              <td mat-cell *matCellDef="let r" class="num">
                {{ r.avgPower !== null ? r.avgPower + ' W' : '–' }}
              </td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>{{ 'history.status' | t }}</th>
              <td mat-cell *matCellDef="let r">
                <span class="status" [class]="r.status">{{
                  'history.statuses.' + r.status | t
                }}</span>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr
              mat-row
              *matRowDef="let r; columns: columns"
              class="row"
              tabindex="0"
              (click)="open(r)"
              (keydown.enter)="open(r)"
              data-testid="ride-row"
            ></tr>
          </table>
        </div>
        <mat-paginator
          [length]="total()"
          [pageIndex]="page()"
          [pageSize]="size()"
          [pageSizeOptions]="[10, 20, 50]"
          (page)="onPage($event)"
        />
      }
    </section>
  `,
  styles: `
    .page {
      padding: 16px;
      max-width: 1100px;
    }
    .filter {
      min-width: 280px;
    }
    .table-wrap {
      overflow-x: auto;
    }
    .row {
      cursor: pointer;
    }
    .row:hover {
      background: var(--mat-sys-surface-container-high);
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .status {
      font-size: 0.8rem;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container-highest);
    }
    .status.IN_PROGRESS {
      background: #5d4037;
    }
    .empty {
      padding: 16px;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class HistoryPage {
  private readonly api = inject(RidesApi);
  private readonly router = inject(Router);
  protected readonly columns = ['date', 'route', 'distance', 'time', 'ascent', 'power', 'status'];
  protected readonly page = signal(0);
  protected readonly size = signal(20);
  protected readonly routeId = signal<string | null>(null);
  protected readonly routes = toSignal(
    inject(RoutesApi)
      .list()
      .pipe(catchError(() => of([]))),
    { initialValue: [] },
  );

  protected readonly rides = rxResource({
    params: () => ({ page: this.page(), size: this.size(), routeId: this.routeId() }),
    stream: ({ params }) => this.api.list(params.page, params.size, params.routeId),
  });
  protected readonly rows = computed(() =>
    this.rides.hasValue() ? this.rides.value().content : [],
  );
  protected readonly total = computed(() =>
    this.rides.hasValue() ? this.rides.value().totalElements : 0,
  );

  protected setRoute(id: string | null): void {
    this.routeId.set(id);
    this.page.set(0);
  }

  protected onPage(e: PageEvent): void {
    this.size.set(e.pageSize);
    this.page.set(e.pageIndex);
  }

  protected open(r: RideSummary): void {
    void this.router.navigate(['/history', r.id]);
  }

  protected km(r: RideSummary): string {
    return r.distanceM === null ? '–' : `${formatKm(r.distanceM)} km`;
  }

  protected time(r: RideSummary): string {
    return r.elapsedTimeS === null ? '–' : formatDuration(r.elapsedTimeS);
  }

  protected ascent(r: RideSummary): string {
    return r.ascentM === null ? '–' : `${formatM(r.ascentM)} m`;
  }
}
