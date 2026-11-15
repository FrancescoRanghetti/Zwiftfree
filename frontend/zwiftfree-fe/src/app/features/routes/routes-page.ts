import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { problemMessage } from '../../core/api/problem';
import { RoutesApi } from '../../core/api/roads.api';
import {
  LatLon,
  PLAN_PROFILES,
  Place,
  PlanProfile,
  RouteDetail,
  RouteSummary,
} from '../../core/api/roads.models';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { RideIntentService } from '../../core/ride/ride-intent.service';
import {
  ElevationProfile,
  ProfileHighlight,
} from '../../shared/elevation-profile/elevation-profile';
import { GRADE_STEPS, formatKm, formatM } from '../../shared/grade';
import { EXPLORED_COLOR, ROAD_TYPE_COLORS, RoadColorMode } from '../../shared/map/map-style';
import { RidesApi } from '../../core/api/rides.api';
import { StatsApi } from '../../core/api/stats.api';
import { SegmentBoard } from '../../core/api/stats.models';
import { formatDuration } from '../../shared/format';
import { TicinoMap } from '../../shared/map/ticino-map';
import { RouteThumbnail } from '../../shared/route-thumbnail/route-thumbnail';
import { PlaceSearch } from './place-search';
import { PlannerStore } from './planner.store';
import { SaveRouteData, SaveRouteDialog } from './save-route-dialog';

type Tab = 'plan' | 'saved';

@Component({
  selector: 'app-routes-page',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    FormsModule,
    MatTabsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatChipsModule,
    MatIconModule,
    MatProgressBarModule,
    MatSlideToggleModule,
    MatTooltipModule,
    TranslatePipe,
    TicinoMap,
    ElevationProfile,
    RouteThumbnail,
    PlaceSearch,
  ],
  providers: [PlannerStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './routes-page.html',
  styleUrl: './routes-page.scss',
})
export class RoutesPage {
  /** ?tab=saved&route=<id> deep link. */
  readonly tab = input<string>();
  readonly route = input<string>();

  protected readonly planner = inject(PlannerStore);
  private readonly routesApi = inject(RoutesApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly rideIntent = inject(RideIntentService);
  private readonly ridesApi = inject(RidesApi);
  private readonly statsApi = inject(StatsApi);
  private readonly i18n = inject(I18nService);
  private readonly map = viewChild(TicinoMap);

  protected readonly profiles = PLAN_PROFILES;
  protected readonly gradeLegend = GRADE_STEPS;
  protected readonly typeLegend = ROAD_TYPE_COLORS;
  protected readonly formatKm = formatKm;
  protected readonly formatM = formatM;

  protected readonly activeTab = signal<Tab>('plan');
  protected readonly colorMode = signal<RoadColorMode>('grade');
  protected readonly place = signal<Place | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly highlight = signal<ProfileHighlight | null>(null);

  protected readonly routes = rxResource({
    stream: () => this.routesApi.list(),
  });
  /** Loaded the first time the "explored" legend mode is chosen (and again when it is re-selected). */
  protected readonly explored = rxResource({
    params: () => (this.colorMode() === 'explored' ? true : undefined),
    stream: () => this.ridesApi.explored(),
  });
  protected readonly exploredColor = EXPLORED_COLOR;
  protected readonly detail = rxResource<RouteDetail | null, string | null>({
    params: () => this.selectedId(),
    stream: ({ params }) => (params ? this.routesApi.get(params) : of(null)),
  });

  /** The user's best times on the selected route's segments. */
  protected readonly leaderboard = rxResource<SegmentBoard[], string | null>({
    params: () => this.selectedId(),
    stream: ({ params }) => (params ? this.statsApi.leaderboard(params) : of([])),
  });
  protected readonly boardsWithTimes = computed(() =>
    (this.leaderboard.value() ?? []).filter((b) => b.efforts.length > 0),
  );

  protected readonly mapRoute = computed(() =>
    this.activeTab() === 'plan'
      ? (this.planner.result()?.coordinates ?? null)
      : (this.detail.value()?.coordinates ?? null),
  );
  protected readonly mapWaypoints = computed(() =>
    this.activeTab() === 'plan' ? this.planner.waypoints() : [],
  );

  constructor() {
    queueMicrotask(() => {
      if (this.tab() === 'saved' || this.route()) this.activeTab.set('saved');
      const id = this.route();
      if (id) this.selectedId.set(id);
    });
  }

  protected onTabChange(index: number): void {
    this.activeTab.set(index === 0 ? 'plan' : 'saved');
    this.highlight.set(null);
  }

  protected onMapClick(p: LatLon): void {
    if (this.activeTab() === 'plan') this.planner.addPoint(p);
  }

  protected onPlace(p: Place): void {
    this.place.set(p);
    this.map()?.flyTo({ lat: p.lat, lon: p.lon }, 14);
  }

  protected addPlaceAsWaypoint(): void {
    const p = this.place();
    if (!p) return;
    this.activeTab.set('plan');
    this.planner.addPoint({ lat: p.lat, lon: p.lon });
    this.place.set(null);
  }

  protected waypointLabel(i: number, total: number): string {
    if (i === 0) return this.i18n.t('routes.start');
    if (i === total - 1) return this.i18n.t('routes.finish');
    return this.i18n.t('routes.via', { n: i });
  }

  protected saveRoute(): void {
    const plan = this.planner.result();
    if (!plan) return;
    const names = plan.roadNames;
    const data: SaveRouteData = {
      plan,
      profile: this.planner.profile(),
      suggestedName:
        names.length >= 2 ? `${names[0]} – ${names[names.length - 1]}` : (names[0] ?? ''),
    };
    this.dialog
      .open<SaveRouteDialog, SaveRouteData, RouteDetail>(SaveRouteDialog, { data })
      .afterClosed()
      .subscribe((saved) => {
        if (!saved) return;
        this.snack.open(this.i18n.t('routes.saved'), undefined, { duration: 3000 });
        this.routes.reload();
        this.activeTab.set('saved');
        this.selectedId.set(saved.summary.id);
      });
  }

  protected selectRoute(r: RouteSummary): void {
    this.highlight.set(null);
    this.selectedId.set(this.selectedId() === r.id ? null : r.id);
  }

  protected async deleteRoute(r: RouteSummary): Promise<void> {
    if (!confirm(this.i18n.t('routes.deleteConfirm', { name: r.name }))) return;
    try {
      await firstValueFrom(this.routesApi.delete(r.id));
      this.selectedId.set(null);
      this.routes.reload();
    } catch (e) {
      this.snack.open(problemMessage(e), 'OK', { duration: 5000 });
    }
  }

  protected ridePlan(): void {
    const plan = this.planner.result();
    if (!plan) return;
    this.rideIntent.set({ kind: 'plan', plan, name: this.i18n.t('routes.plannedRide') });
    void this.router.navigate(['/ride']);
  }

  protected rideRoute(r: RouteSummary): void {
    this.rideIntent.set({ kind: 'route', routeId: r.id, name: r.name });
    void this.router.navigate(['/ride'], { queryParams: { route: r.id } });
  }

  protected freeRideFrom(p: LatLon | null, name: string): void {
    if (!p) return;
    this.rideIntent.set({ kind: 'free', lat: p.lat, lon: p.lon, name });
    void this.router.navigate(['/ride'], {
      queryParams: { free: `${p.lat.toFixed(5)},${p.lon.toFixed(5)}` },
    });
  }

  protected freeRideFromStart(): void {
    this.freeRideFrom(this.planner.waypoints()[0] ?? null, this.i18n.t('routes.start'));
  }

  protected profileLabel(p: PlanProfile | null): string {
    return p ? this.i18n.t('routes.profiles.' + p) : '';
  }

  protected duration(s: number): string {
    return formatDuration(s);
  }

  protected exploredPercent(p: number): string {
    return p.toLocaleString('it-CH', { maximumFractionDigits: p < 1 ? 2 : 1 });
  }
}
