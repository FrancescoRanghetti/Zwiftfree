import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { RoutesApi } from '../../core/api/roads.api';
import { Place } from '../../core/api/roads.models';
import { problemMessage } from '../../core/api/problem';
import { AuthService } from '../../core/auth/auth.service';
import { RideView } from '../../core/auth/auth.models';
import { MeService } from '../../core/auth/me.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { RideIntent, RideIntentService } from '../../core/ride/ride-intent.service';
import { AvatarRider } from '../../avatar/avatar-rider';
import { choiceForKey } from '../../physics/junctions';
import { SIM_STEP_W } from '../../devices/simulator-trainer';
import { ElevationProfile } from '../../shared/elevation-profile/elevation-profile';
import { formatKm, formatM } from '../../shared/grade';
import { PlaceSearch } from '../routes/place-search';
import { RideHud } from './ride-hud';
import { RideMap } from './ride-map';
import { RideScene3d } from './ride-scene-3d';
import { RideSession, formatDuration } from './ride-session';
import { DeviceStatusService } from '../../devices/device-status.service';
import { DevicePicker } from './device-picker';
import { SimPanel } from './sim-panel';
import { TurnArrows } from './turn-arrows';

/** Pre-ride (choice, simulator, weight/FTP) and the live ride screen. */
@Component({
  selector: 'app-ride-page',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    TranslatePipe,
    AvatarRider,
    ElevationProfile,
    PlaceSearch,
    RideHud,
    RideMap,
    RideScene3d,
    SimPanel,
    TurnArrows,
    DevicePicker,
  ],
  providers: [RideSession],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ride-page.html',
  styleUrl: './ride-page.scss',
  host: { '(document:keydown)': 'onKey($event)' },
})
export class RidePage {
  /** ?route=<id> or ?free=lat,lon survive a reload even without the in-memory intent. */
  readonly route = input<string>();
  readonly free = input<string>();

  protected readonly session = inject(RideSession);
  protected readonly devices = inject(DeviceStatusService);
  private readonly rideIntent = inject(RideIntentService);
  private readonly auth = inject(AuthService);
  private readonly meService = inject(MeService);
  private readonly routesApi = inject(RoutesApi);

  protected readonly followHeading = signal(true);
  protected readonly lockZoom = signal(true);
  private readonly viewOverride = signal<RideView | null>(null);
  protected readonly rideView = computed(
    () => this.viewOverride() ?? this.auth.me()?.settings.rideView ?? 'MAP_2D',
  );
  protected readonly sceneQuality = computed(
    () => this.auth.me()?.settings.sceneQuality ?? 'MEDIUM',
  );
  protected readonly headBobEnabled = computed(
    () => this.auth.me()?.settings.headBobEnabled ?? false,
  );
  protected readonly viewNotice = signal<'ride.sceneTooSlow' | 'ride.sceneUnavailable' | null>(
    null,
  );
  protected readonly confirmEnd = signal(false);
  protected readonly starting = signal(false);
  protected readonly startError = signal<string | null>(null);
  protected readonly avatar = computed(
    () =>
      this.auth.me()?.profile.avatar ?? {
        jerseyColor: '#f57c00',
        helmetColor: '#ffffff',
        bikeColor: '#263238',
      },
  );

  protected readonly intent = computed<RideIntent | null>(() => {
    const i = this.rideIntent.intent();
    if (i) return i;
    const id = this.route();
    if (id) return { kind: 'route', routeId: id, name: '' };
    const free = this.free()?.split(',').map(Number);
    if (free?.length === 2 && free.every(Number.isFinite)) {
      return { kind: 'free', lat: free[0], lon: free[1], name: '' };
    }
    return null;
  });

  /** Routes offered when the rider opens "Pedala" without choosing anything first. */
  protected readonly routes = toSignal(this.routesApi.list().pipe(catchError(() => of([]))), {
    initialValue: [],
  });

  protected readonly rider = new FormGroup({
    weightKg: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(30),
      Validators.max(250),
    ]),
    ftpWatts: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(50),
      Validators.max(600),
    ]),
  });

  protected readonly highlight = computed(() => {
    const pos = this.session.positionM();
    return { startM: pos, endM: pos + 2000 };
  });

  constructor() {
    effect(() => {
      const i = this.intent();
      if (i) untracked(() => void this.session.prepare(i));
    });
    effect(() => {
      const me = this.auth.me();
      if (me && this.rider.pristine) {
        this.rider.setValue(
          { weightKg: me.profile.weightKg, ftpWatts: me.profile.ftpWatts },
          { emitEvent: false },
        );
      }
    });
  }

  protected chooseRoute(id: string, name: string): void {
    this.rideIntent.set({ kind: 'route', routeId: id, name });
  }

  protected freeRideFrom(p: Place): void {
    this.rideIntent.set({ kind: 'free', lat: p.lat, lon: p.lon, name: p.name });
  }

  protected time(s: number): string {
    return formatDuration(s);
  }

  protected ceil(v: number): number {
    return Math.ceil(v);
  }

  protected km(m: number | null): string {
    return m === null ? '–' : formatKm(m);
  }

  protected m(v: number | null): string {
    return v === null ? '–' : formatM(v);
  }

  protected async begin(): Promise<void> {
    if (this.rider.invalid || this.starting()) return;
    this.starting.set(true);
    this.startError.set(null);
    try {
      const me = this.auth.me();
      const { weightKg, ftpWatts } = this.rider.getRawValue();
      if (me && (weightKg !== me.profile.weightKg || ftpWatts !== me.profile.ftpWatts)) {
        await this.meService.updateProfile({
          ...me.profile,
          displayName: me.displayName,
          weightKg: weightKg!,
          ftpWatts: ftpWatts!,
        });
        this.session.refreshRider();
      }
      await this.session.begin();
    } catch (e) {
      this.startError.set(problemMessage(e));
    } finally {
      this.starting.set(false);
    }
  }

  protected end(): void {
    if (!this.confirmEnd()) {
      this.confirmEnd.set(true);
      setTimeout(() => this.confirmEnd.set(false), 4000);
      return;
    }
    this.confirmEnd.set(false);
    void this.session.finish();
  }

  /** A view change applies only to this ride; the saved preference belongs to Settings. */
  protected cycleView(): void {
    const next: Record<RideView, RideView> = {
      MAP_2D: 'THIRD_PERSON',
      THIRD_PERSON: 'FIRST_PERSON',
      FIRST_PERSON: 'MAP_2D',
    };
    this.viewOverride.set(next[this.rideView()]);
    this.viewNotice.set(null);
  }

  protected fallbackToMap(reason: 'performance' | 'unavailable'): void {
    this.viewOverride.set('MAP_2D');
    this.viewNotice.set(reason === 'performance' ? 'ride.sceneTooSlow' : 'ride.sceneUnavailable');
  }

  /** ←/→ choose a turn, ↑ goes straight when arrows are shown (otherwise +10 W), ↓ −10 W, space pauses. */
  protected onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
    )
      return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const phase = this.session.phase();
    if (e.key.toLowerCase() === 'v' && (phase === 'ready' || phase === 'riding')) {
      if (!e.repeat) this.cycleView();
      e.preventDefault();
      return;
    }
    if (phase !== 'riding') return;
    const choices = this.session.choices();
    const key = e.key;
    if (key === 'ArrowLeft' || key === 'ArrowRight' || (key === 'ArrowUp' && choices.length)) {
      const i = choiceForKey(
        choices,
        key === 'ArrowLeft' ? 'left' : key === 'ArrowRight' ? 'right' : 'up',
      );
      if (i >= 0) this.session.choose(i);
      e.preventDefault();
    } else if ((key === 'ArrowUp' || key === '+') && this.session.usingSimulator()) {
      this.session.simulator.nudge(SIM_STEP_W);
      e.preventDefault();
    } else if ((key === 'ArrowDown' || key === '-') && this.session.usingSimulator()) {
      this.session.simulator.nudge(-SIM_STEP_W);
      e.preventDefault();
    } else if (key === ' ' && !(target instanceof HTMLButtonElement)) {
      this.session.togglePause();
      e.preventDefault();
    }
  }
}
