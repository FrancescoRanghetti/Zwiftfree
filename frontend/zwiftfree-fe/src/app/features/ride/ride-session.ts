import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { RoadsApi, RoutesApi } from '../../core/api/roads.api';
import { Coord3, LatLon, Place, ProfilePoint, SegmentOnRoute } from '../../core/api/roads.models';
import { RidesApi } from '../../core/api/rides.api';
import { RideEvent, RideEventType } from '../../core/api/rides.models';
import { problemMessage } from '../../core/api/problem';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { RideIntent } from '../../core/ride/ride-intent.service';
import { RideUploader } from '../../core/ride/ride-uploader.service';
import { windResistanceCoefficient } from '../../devices/ble/ftms-protocol';
import { DeviceManager } from '../../devices/device-manager.service';
import { DeviceStatus, DeviceStatusService } from '../../devices/device-status.service';
import { TrainerDevice } from '../../devices/trainer';
import { SimulatorHeartRate, SimulatorTrainer } from '../../devices/simulator-trainer';
import { Course, courseFromRoute } from '../../physics/course';
import { AvatarEvent, AvatarMachine } from '../../avatar/avatar-machine';
import { TurnChoice } from '../../physics/junctions';
import { riderParams } from '../../physics/physics';
import {
  AREA_RADIUS_M,
  RideEdgeEntry,
  RideEngine,
  RideKind,
  RideSample,
  RiderState,
  freeRideCourse,
} from '../../physics/ride-engine';
import { RoadGraph } from '../../physics/road-graph';
import { formatKm } from '../../shared/grade';
import { PlaceAhead, nextAlong, nextInFront, placesAlong } from './places-ahead';
import { StatsApi } from '../../core/api/stats.api';
import { formatDuration, formatRecordValue } from '../../shared/format';
import { RecordWatch } from './record-watch';
import { LiveService } from '../../core/live/live.service';
import { hrZone, maxHr } from '../../shared/zones';

/** Re-exported for the ride screen components. */
export { formatDuration, hrZone, maxHr };

export type RidePhase = 'loading' | 'ready' | 'riding' | 'finishing' | 'error';

export interface Hud {
  speedKmh: number;
  power3s: number;
  wkg: number;
  cadence: number;
  hr: number | null;
  /** 1–5, 0 when unknown */
  hrZone: number;
  grade: number;
  distanceM: number;
  remainingM: number | null;
  ascentM: number;
  timeS: number;
  np: number | null;
  state: RiderState;
  /** Seconds in the current state (pee break timer). */
  stateSeconds: number;
  /** Seconds before pedalling gets the rider back up after a crash. */
  penaltyLeft: number;
  /** Climbing back on the bike after a pee break. */
  remounting: boolean;
  road: string | null;
  nextPlace: PlaceAhead | null;
}

export interface FramePosition {
  lon: number;
  lat: number;
  ele: number;
  heading: number;
  cameraHeading: number;
  grade: number;
  lookAhead: { lon: number; lat: number; ele: number };
  firstLookAhead: { lon: number; lat: number; ele: number };
  distanceM: number;
}

const EMPTY_HUD: Hud = {
  speedKmh: 0,
  power3s: 0,
  wkg: 0,
  cadence: 0,
  hr: null,
  hrZone: 0,
  grade: 0,
  distanceM: 0,
  remainingM: null,
  ascentM: 0,
  timeS: 0,
  np: null,
  state: 'IDLE',
  stateSeconds: 0,
  penaltyLeft: 0,
  remounting: false,
  road: null,
  nextPlace: null,
};

/** Samples are sent in blocks of this many seconds (spec §9). */
export const BLOCK_SECONDS = 30;
/** Rides shorter than this are discarded instead of saved. */
export const MIN_SAVED_SECONDS = 10;
const TICK_MS = 100;
/** Trainer data older than this counts as 0 W (the trainer stopped sending). */
export const STALE_MS = 3000;

/**
 * One ride on the ride screen: loads the course, drives the engine at 10 Hz with the simulator, keeps the HUD
 * signals up to date, uploads samples every 30 s and completes the ride. Provided by the ride page.
 */
@Injectable()
export class RideSession {
  private readonly roadsApi = inject(RoadsApi);
  private readonly routesApi = inject(RoutesApi);
  private readonly ridesApi = inject(RidesApi);
  private readonly statsApi = inject(StatsApi);
  private readonly live = inject(LiveService);
  private liveHeld = false;
  private lastSample: RideSample | null = null;
  private readonly uploader = inject(RideUploader);
  private readonly auth = inject(AuthService);
  private readonly devices = inject(DeviceStatusService);
  private readonly i18n = inject(I18nService);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly phase = signal<RidePhase>('loading');
  readonly error = signal<string | null>(null);
  readonly title = signal('');
  readonly kind = signal<RideKind>('free');
  readonly hud = signal<Hud>(EMPTY_HUD);
  readonly profile = signal<ProfilePoint[]>([]);
  /** Rider position on the profile, updated once per second. */
  readonly positionM = signal(0);
  readonly plannedLine = signal<Coord3[] | null>(null);
  readonly riddenLine = signal<Coord3[]>([]);
  readonly choices = signal<TurnChoice[]>([]);
  readonly selected = signal(-1);
  readonly paused = signal(false);
  readonly canTurnAround = signal(false);
  readonly start = signal<LatLon | null>(null);
  readonly lengthM = signal<number | null>(null);
  readonly ascentPlannedM = signal<number | null>(null);
  readonly trainerGrade = signal(0);
  /** Increases at every crash (the map shakes). */
  readonly crashes = signal(0);
  readonly uploadPending = this.uploader.pending;
  readonly offline = this.uploader.offline;

  /** Always available; used when no Bluetooth trainer is connected. */
  readonly simulator = new SimulatorTrainer();
  readonly simHeartRate: SimulatorHeartRate;
  /** True when the ride runs on the simulator (power from the slider). */
  readonly usingSimulator = signal(true);
  readonly trainerName = signal<string | null>(null);
  readonly hrName = signal<string | null>(null);
  private readonly manager = inject(DeviceManager);
  private activeTrainer: TrainerDevice = this.simulator;
  private lastTrainerDataAt = 0;
  private lastHrAt = 0;

  private engine: RideEngine | null = null;
  private graph = new RoadGraph();
  private routeId: string | null = null;
  private rideId: string | null = null;
  private segments: SegmentOnRoute[] = [];
  private segmentStart = new Map<string, number>();
  private recordWatch: RecordWatch | null = null;
  private places: Place[] = [];
  private along: { name: string; atM: number }[] | null = null;
  private samples: RideSample[] = [];
  private edges: RideEdgeEntry[] = [];
  private input = { power: 0, cadence: 0, hr: null as number | null };
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private lastTickAt = 0;
  private lastSecond = -1;
  private lastGradeSent = Number.NaN;
  private frameListeners = new Set<(p: FramePosition) => void>();
  private subs: Subscription[] = [];
  private wakeLock: { release(): Promise<void> } | null = null;
  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible' && this.phase() === 'riding') void this.lockScreen();
  };

  constructor() {
    const me = this.auth.me();
    const p = me?.profile;
    this.simHeartRate = new SimulatorHeartRate(
      () => this.simulator.targetPower(),
      p?.restingHr ?? 60,
      maxHr(me),
      p?.ftpWatts ?? 200,
    );
    inject(DestroyRef).onDestroy(() => this.teardown());
    // Tell the rider when the Bluetooth trainer drops out or comes back during the ride.
    let previous: DeviceStatus | null = null;
    effect(() => {
      const status = this.manager.trainer()?.status() ?? null;
      const riding = untracked(() => this.phase() === 'riding' && !this.usingSimulator());
      if (riding && status !== previous) {
        const key =
          status === 'connecting'
            ? 'ride.trainerReconnecting'
            : status === 'error'
              ? 'ride.trainerLost'
              : status === 'connected' && previous !== null
                ? 'ride.trainerBack'
                : null;
        if (key) untracked(() => this.snack.open(this.i18n.t(key), undefined, { duration: 5000 }));
      }
      previous = status;
    });
  }

  /** Loads the course for the chosen ride and gets the engine ready (nothing is saved yet). */
  async prepare(intent: RideIntent): Promise<void> {
    this.phase.set('loading');
    this.error.set(null);
    try {
      let course: Course;
      switch (intent.kind) {
        case 'route': {
          const d = await firstValueFrom(this.routesApi.get(intent.routeId));
          course = courseFromRoute(d.coordinates, d.edgeIds, d.directions, d.edgeStartsM);
          this.routeId = d.summary.id;
          this.title.set(d.summary.name);
          this.segments = d.segments.filter((s) => s.startM > 0 || s.endM < d.summary.lengthM);
          this.plannedLine.set(d.coordinates);
          this.profile.set(d.elevationProfile);
          this.lengthM.set(d.summary.lengthM);
          this.ascentPlannedM.set(d.summary.ascentM);
          this.kind.set('route');
          break;
        }
        case 'plan': {
          const plan = intent.plan;
          course = courseFromRoute(
            plan.coordinates,
            plan.edgeIds,
            plan.directions,
            plan.edgeStartsM,
          );
          this.title.set(intent.name || this.i18n.t('ride.intentPlan'));
          this.plannedLine.set(plan.coordinates);
          this.profile.set(plan.profile);
          this.lengthM.set(plan.lengthM);
          this.ascentPlannedM.set(plan.ascentM);
          this.kind.set('route');
          break;
        }
        case 'free': {
          const point = { lat: intent.lat, lon: intent.lon };
          const nearest = await firstValueFrom(this.roadsApi.nearest(point));
          await this.loadArea(point);
          const edge = this.graph.edge(nearest.edge.id);
          if (!edge) throw new Error(this.i18n.t('ride.noRoadHere'));
          course = freeRideCourse(edge, nearest.edge.fraction);
          const place = intent.name || nearest.edge.name;
          this.title.set(
            place ? `${this.i18n.t('ride.intentFree')} ${place}` : this.i18n.t('ride.freeRide'),
          );
          this.kind.set('free');
          this.profile.set(course.profile());
          break;
        }
      }
      if (!course.legs.length) throw new Error(this.i18n.t('ride.emptyCourse'));
      const first = course.pointAt(0);
      this.start.set({ lat: first.lat, lon: first.lon });
      if (intent.kind !== 'free') void this.loadArea(this.start()!).catch(() => undefined);
      const settings = this.auth.me()?.settings;
      const avatar = new AvatarMachine({
        peeBreakEnabled: settings?.peeBreakEnabled ?? true,
        peeBreakAfterS: settings?.peeBreakAfterSeconds ?? 20,
        crashesEnabled: settings?.crashEventsEnabled ?? true,
      });
      this.engine = new RideEngine(
        course,
        this.graph,
        this.kind(),
        this.riderParams(),
        {
          avatarEvent: (ev) => this.onAvatarEvent(ev),
          sample: (s) => this.onSample(s),
          edgeEntered: (e) => this.edges.push(e),
          finished: () => queueMicrotask(() => void this.finish()),
          needArea: (p) => {
            this.loadArea(p)
              .catch(() => undefined)
              .finally(() => this.engine?.areaSettled());
          },
          choicesChanged: (c, sel) => {
            this.choices.set(c);
            this.selected.set(sel);
            if (this.kind() === 'free') this.profile.set(this.engine!.course.profile());
          },
          turnaroundFallback: () => {
            this.kind.set('free');
            this.snack.open(this.i18n.t('ride.turnaroundOneWay'), undefined, { duration: 5000 });
          },
        },
        avatar,
      );
      this.engine.cornerAssist = settings?.cornerAssistEnabled ?? false;
      this.updateHud();
      this.phase.set('ready');
      firstValueFrom(this.roadsApi.allPlaces())
        .then((p) => {
          this.places = p;
          if (this.kind() === 'route' && this.engine)
            this.along = placesAlong(this.engine.course, p);
          this.updateSecondly();
        })
        .catch(() => undefined);
    } catch (e) {
      this.error.set(
        e instanceof HttpErrorResponse ? problemMessage(e) : String((e as Error)?.message ?? e),
      );
      this.phase.set('error');
    }
  }

  /** Rider weight/FTP may have been edited on the pre-ride screen. */
  refreshRider(): void {
    this.engine?.setRider(this.riderParams());
  }

  async begin(): Promise<void> {
    if (this.phase() !== 'ready' || !this.engine) return;
    // A Bluetooth trainer that is connected (or reconnecting) wins over the simulator.
    const real = this.manager.trainer();
    const useReal = !!real && real.status() !== 'error' && real.status() !== 'disconnected';
    try {
      const ride = await firstValueFrom(
        this.ridesApi.create(this.routeId, useReal ? 'TRAINER' : 'SIMULATOR'),
      );
      this.rideId = ride.id;
      this.watchRecords();
      this.holdLive();
    } catch (e) {
      this.error.set(problemMessage(e));
      return;
    }
    this.usingSimulator.set(!useReal);
    this.activeTrainer = useReal ? real! : this.simulator;
    this.trainerName.set(useReal ? real!.name : null);
    if (!useReal) await this.simulator.connect();
    const realHr = this.manager.heartRate();
    const hrSource = realHr ?? (useReal ? null : this.simHeartRate);
    if (hrSource === this.simHeartRate) await this.simHeartRate.connect();
    this.hrName.set(realHr?.name ?? null);
    // Whatever was computed before the start went nowhere: send the current grade to this trainer now.
    this.lastGradeSent = Number.NaN;
    this.sendGrade(this.engine.grade);
    this.devices.simulatedTrainer.set(!useReal);
    this.devices.simulatedHeartRate.set(hrSource === this.simHeartRate);
    this.lastTrainerDataAt = performance.now();
    this.subs.push(
      this.activeTrainer.data$.subscribe((d) => {
        this.lastTrainerDataAt = performance.now();
        this.input.power = Math.max(0, d.power ?? 0);
        this.input.cadence = d.cadence ?? 0;
      }),
    );
    if (hrSource) {
      this.subs.push(
        hrSource.hr$.subscribe((hr) => {
          this.lastHrAt = performance.now();
          this.input.hr = hr > 0 ? hr : null;
        }),
      );
    }
    this.phase.set('riding');
    this.lastTickAt = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    const frame = () => {
      this.renderFrame();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.lockScreen();
  }

  onFrame(cb: (p: FramePosition) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  /** Current interpolated position, also before the ride starts (for the map's first view). */
  position(): FramePosition | null {
    const e = this.engine;
    if (!e) return null;
    const alpha = (performance.now() - this.lastTickAt) / TICK_MS;
    const d = this.phase() === 'riding' ? e.renderDistance(alpha) : e.distance;
    const p = e.course.pointAt(d);
    return {
      lon: p.lon,
      lat: p.lat,
      ele: p.ele,
      heading: e.course.headingAt(d),
      cameraHeading: e.course.headingAt(d, 20),
      grade: e.course.gradeAt(d),
      lookAhead: e.course.pointAt(Math.min(e.course.lengthM, d + 18)),
      firstLookAhead: e.course.pointAt(Math.min(e.course.lengthM, d + 14)),
      distanceM: d,
    };
  }

  togglePause(): void {
    const e = this.engine;
    if (!e || this.phase() !== 'riding') return;
    if (this.paused()) {
      e.resume();
      this.paused.set(false);
      this.event('RESUME');
    } else {
      e.pause();
      this.paused.set(true);
      this.event('PAUSE');
    }
    this.updateHud();
  }

  choose(index: number): void {
    this.engine?.choose(index);
  }

  turnAround(): void {
    const e = this.engine;
    if (!e?.turnAround()) return;
    this.profile.set(e.course.profile());
    this.lengthM.set(this.kind() === 'route' ? e.course.lengthM : null);
    if (this.kind() === 'route') this.along = placesAlong(e.course, this.places);
    this.snack.open(this.i18n.t('ride.turnedAround'), undefined, { duration: 2500 });
    this.updateSecondly();
  }

  /** Seconds recorded so far (ride clock). */
  recordedSeconds(): number {
    return Math.floor(this.engine?.clock ?? 0);
  }

  /** Ends the ride: short rides are discarded, others are completed and the summary opens. */
  async finish(): Promise<void> {
    if (this.phase() !== 'riding' || !this.rideId) return;
    this.phase.set('finishing');
    this.stopLoops();
    if (this.lastSample) this.publishLive(this.lastSample, 'FINISHED');
    this.releaseLive();
    const rideId = this.rideId;
    if (this.recordedSeconds() < MIN_SAVED_SECONDS) {
      await this.disconnectDevices();
      await firstValueFrom(this.ridesApi.delete(rideId)).catch(() => undefined);
      this.snack.open(this.i18n.t('ride.tooShort'), undefined, { duration: 4000 });
      void this.router.navigate(['/home']);
      return;
    }
    this.flushBlock();
    await this.disconnectDevices();
    try {
      const done = await this.uploader.complete(rideId);
      if (done) {
        void this.router.navigate(['/history', rideId]);
      } else {
        this.snack.open(this.i18n.t('ride.savedOffline'), undefined, { duration: 6000 });
        void this.router.navigate(['/history']);
      }
    } catch (e) {
      this.snack.open(problemMessage(e), undefined, { duration: 6000 });
      void this.router.navigate(['/history']);
    }
  }

  private tick(): void {
    const e = this.engine;
    if (!e) return;
    const now = performance.now();
    // A trainer that stopped sending (out of range, reconnecting) must not keep the last power forever.
    if (now - this.lastTrainerDataAt > STALE_MS) {
      this.input.power = 0;
      this.input.cadence = 0;
    }
    if (this.input.hr !== null && now - this.lastHrAt > STALE_MS * 2) this.input.hr = null;
    // Background tabs throttle timers: catch up in 0.1 s steps (at most one minute).
    let dt = Math.min(60, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;
    while (dt > 1e-6 && this.phase() === 'riding') {
      const step = Math.min(0.1, dt);
      e.tick(step, this.input);
      dt -= step;
    }
    this.updateHud();
    const second = Math.floor(e.clock);
    if (second !== this.lastSecond) {
      this.lastSecond = second;
      this.updateSecondly();
    }
  }

  private renderFrame(): void {
    if (!this.frameListeners.size) return;
    const p = this.position();
    if (p) for (const cb of this.frameListeners) cb(p);
  }

  /** Opens the live connection (second screen); the ride works the same without it. */
  private holdLive(): void {
    if (this.liveHeld) return;
    this.liveHeld = true;
    this.live.acquire().catch(() => undefined);
  }

  private releaseLive(): void {
    if (!this.liveHeld) return;
    this.liveHeld = false;
    this.live.release();
  }

  private publishLive(s: RideSample, state = s.avatarState): void {
    if (!this.liveHeld) return;
    const h = this.hud();
    this.live.publish({
      routeId: this.routeId,
      distanceM: s.distanceM,
      speedKmh: s.speedKmh,
      power: h.power3s,
      cadence: s.cadence,
      hr: s.hr,
      grade: s.grade,
      lat: s.lat,
      lon: s.lon,
      remainingM: h.remainingM,
      elapsedS: s.t,
      avatarState: state,
      road: h.road,
      title: this.title() || null,
    });
  }

  /** Loads the personal records in the background; without them there are simply no record toasts. */
  private watchRecords(): void {
    this.statsApi.records().subscribe({
      next: (list) => {
        const byMetric: Record<string, number> = {};
        for (const r of list ?? []) byMetric[r.metric] = r.value;
        this.recordWatch = new RecordWatch(byMetric);
      },
      error: () => undefined,
    });
  }

  private onSample(s: RideSample): void {
    this.samples.push(s);
    this.lastSample = s;
    this.publishLive(s);
    for (const r of this.recordWatch?.onSecond(s.power, s.distanceM) ?? []) {
      this.snack.open(
        this.i18n.t('ride.newRecord', {
          name: this.i18n.t(`stats.metrics.${r.metric}`),
          value: formatRecordValue(r.metric, r.value),
        }),
        undefined,
        { duration: 6000 },
      );
    }
    if (this.samples.length >= BLOCK_SECONDS) this.flushBlock();
  }

  private flushBlock(): void {
    if (!this.rideId || (!this.samples.length && !this.edges.length)) return;
    const body = { samples: this.samples, edges: this.edges };
    this.samples = [];
    this.edges = [];
    void this.uploader.enqueue({ rideId: this.rideId, kind: 'samples', body });
  }

  private event(type: RideEventType, payload?: Record<string, unknown>): void {
    if (!this.rideId || !this.engine) return;
    const ev: RideEvent = {
      id: crypto.randomUUID(),
      t: Math.floor(this.engine.clock),
      type,
      distanceM: Math.round(this.engine.distance * 10) / 10,
      payload: payload ?? null,
    };
    void this.uploader.enqueue({ rideId: this.rideId, kind: 'events', body: [ev] });
  }

  private onAvatarEvent(ev: AvatarEvent): void {
    this.event(ev.type, ev.payload);
    if (ev.type === 'CRASH') {
      this.crashes.update((n) => n + 1);
      this.sendGrade(0);
    } else if (ev.type === 'PEE_BREAK_START') {
      this.sendGrade(0);
    }
  }

  private updateHud(): void {
    const e = this.engine;
    if (!e) return;
    const me = this.auth.me();
    const weight = me?.profile.weightKg ?? 75;
    const leg = e.course.legs[e.course.legIndexAt(e.distance)];
    const edge = leg?.edgeId == null ? undefined : this.graph.edge(leg.edgeId);
    const prev = this.hud();
    this.hud.set({
      speedKmh: e.speed * 3.6,
      power3s: Math.round(e.power3s),
      wkg: e.power3s / weight,
      cadence: this.input.cadence,
      hr: this.input.hr,
      hrZone: hrZone(this.input.hr, maxHr(me)),
      grade: e.grade,
      distanceM: e.distance,
      remainingM: e.remainingM,
      ascentM: e.ascent,
      timeS: e.clock,
      np: e.normalizedPower,
      state: e.state,
      stateSeconds: e.avatar.inState,
      penaltyLeft: e.avatar.penaltyLeft,
      remounting: e.avatar.remountLeft > 0,
      road: edge ? edge.name : prev.road,
      nextPlace: prev.nextPlace,
    });
  }

  /** Work done once per second: map lines, profile marker, trainer grade, toasts, next locality. */
  private updateSecondly(): void {
    const e = this.engine;
    if (!e) return;
    const d = e.distance;
    this.positionM.set(d);
    this.riddenLine.set(d > 1 ? e.course.coordsBetween(0, d) : []);
    this.canTurnAround.set(e.canTurnAround());
    this.sendGrade(e.grade);
    this.segmentToasts(d, e.clock);
    let next: PlaceAhead | null = null;
    if (this.kind() === 'route' && this.along) next = nextAlong(this.along, d);
    else if (this.places.length) {
      const p = e.course.pointAt(d);
      next = nextInFront(this.places, p, e.course.headingAt(d, 30));
    }
    this.hud.update((h) => ({ ...h, nextPlace: next }));
  }

  /** Spec §6: difficulty scales the grade, descents are limited to −5% on the trainer, 0% when paused. */
  private sendGrade(grade: number): void {
    const difficulty = this.auth.me()?.settings.trainerDifficulty ?? 1;
    // Nothing strange on the trainer while the rider is off the bike (spec §8): flat.
    const off = ['CRASHED', 'RECOVERING', 'PEE_BREAK'].includes(this.engine?.state ?? '');
    let g = this.paused() || off ? 0 : grade * difficulty;
    if (g < -5) g = -5;
    g = Math.round(g * 10) / 10;
    if (Number.isNaN(this.lastGradeSent) || Math.abs(g - this.lastGradeSent) > 0.1) {
      this.lastGradeSent = g;
      this.trainerGrade.set(g);
      const p = this.auth.me()?.profile;
      void this.activeTrainer
        .setSimulation(g, 0, p?.crr ?? 0.004, windResistanceCoefficient(p?.cda ?? 0.32))
        .catch(() => undefined);
    }
  }

  private segmentToasts(d: number, clock: number): void {
    for (const s of this.segments) {
      if (s.type !== 'CLIMB') continue;
      if (!this.segmentStart.has(s.id) && d >= s.startM && d < s.endM) {
        this.segmentStart.set(s.id, clock);
        this.snack.open(
          this.i18n.t('ride.climbStart', {
            name: s.name,
            km: formatKm(s.lengthM),
            grade: s.avgGrade.toFixed(1),
          }),
          undefined,
          { duration: 6000 },
        );
      } else if (this.segmentStart.has(s.id) && this.segmentStart.get(s.id)! >= 0 && d >= s.endM) {
        const took = clock - this.segmentStart.get(s.id)!;
        this.segmentStart.set(s.id, -1);
        this.snack.open(
          this.i18n.t('ride.climbDone', { name: s.name, time: formatDuration(took) }),
          undefined,
          { duration: 6000 },
        );
      }
    }
  }

  private async loadArea(p: LatLon): Promise<void> {
    const edges = await firstValueFrom(this.roadsApi.area(p, AREA_RADIUS_M));
    this.graph.add(edges, p, AREA_RADIUS_M);
  }

  private riderParams() {
    const p = this.auth.me()?.profile;
    return riderParams(p?.weightKg ?? 75, p?.bikeWeightKg ?? 8, p?.cda ?? 0.32, p?.crr ?? 0.004);
  }

  private async lockScreen(): Promise<void> {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
      };
      this.wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      this.wakeLock = null; // not supported or refused: the ride still works
    }
  }

  private stopLoops(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  /**
   * Stops listening. Simulators are switched off; Bluetooth devices stay connected for the next ride, with the
   * trainer set back to flat.
   */
  private async disconnectDevices(): Promise<void> {
    for (const s of this.subs) s.unsubscribe();
    this.subs = [];
    if (!this.usingSimulator()) {
      const p = this.auth.me()?.profile;
      await this.activeTrainer
        .setSimulation(0, 0, p?.crr ?? 0.004, windResistanceCoefficient(p?.cda ?? 0.32))
        .catch(() => undefined);
    }
    await this.simulator.disconnect();
    await this.simHeartRate.disconnect();
    this.devices.simulatedTrainer.set(false);
    this.devices.simulatedHeartRate.set(false);
  }

  /** Leaving the page mid-ride: keep what was recorded (the ride stays in progress and can be completed later). */
  private teardown(): void {
    this.stopLoops();
    this.releaseLive();
    if (this.phase() === 'riding') this.flushBlock();
    void this.disconnectDevices();
  }
}
