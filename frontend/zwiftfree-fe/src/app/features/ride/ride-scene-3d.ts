import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type * as Cesium from 'cesium';
import { AuthService } from '../../core/auth/auth.service';
import { RideView, SceneQuality } from '../../core/auth/auth.models';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { distance, turn } from '../../physics/geo';
import { RideSession } from './ride-session';
import {
  CameraMotion,
  ScenePoint,
  aboveGround,
  firstPersonPose,
  frustumFov,
  smoothPose,
  startMotion,
  thirdPersonPose,
} from './scene3d/camera';
import { FrameRateMonitor } from './scene3d/performance';
import { QUALITY, SCENE_SOURCES } from './scene3d/sources';

/** Read-only renderer of the same interpolated ride state as RideMap. Cesium loads only on entry. */
@Component({
  selector: 'app-ride-scene-3d',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.with-profile]': 'withProfile()' },
  template: `
    <div
      #container
      class="scene"
      data-testid="ride-scene-3d"
      [attr.data-view]="view()"
      [attr.data-ready]="!loading()"
    ></div>
    @if (loading()) {
      <div class="loading" role="status">{{ 'ride.sceneLoading' | t }}</div>
    }
    <a
      class="attribution"
      href="https://www.swisstopo.admin.ch"
      target="_blank"
      rel="noopener noreferrer"
      >© swisstopo</a
    >
    <div #credits class="credits"></div>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      background: #172c3a;
    }
    .scene {
      position: absolute;
      inset: 0;
    }
    :host(.with-profile) .scene {
      bottom: 180px;
    }
    .loading {
      position: absolute;
      top: 12px;
      left: 12px;
      background: #172c3aee;
      padding: 8px 12px;
      border-radius: 8px;
      color: white;
    }
    .attribution {
      position: absolute;
      left: 8px;
      bottom: 184px;
      color: white;
      background: #121212bb;
      padding: 2px 6px;
      font-size: 11px;
      z-index: 1;
    }
    .credits {
      position: absolute;
      right: 4px;
      bottom: 184px;
      font-size: 10px;
      z-index: 1;
    }
    @media (max-width: 700px) {
      :host(.with-profile) .scene {
        bottom: 140px;
      }
      .attribution,
      .credits {
        bottom: 144px;
      }
    }
  `,
})
export class RideScene3d {
  readonly view = input<Exclude<RideView, 'MAP_2D'>>('THIRD_PERSON');
  readonly quality = input<SceneQuality>('MEDIUM');
  readonly headBobEnabled = input(false);
  readonly fallback = output<'performance' | 'unavailable'>();
  protected readonly loading = signal(true);

  private readonly session = inject(RideSession);
  protected readonly withProfile = computed(() => this.session.phase() !== 'ready');
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly credits = viewChild.required<ElementRef<HTMLDivElement>>('credits');
  private viewer: Cesium.Viewer | null = null;
  private destroyed = false;
  private failed = false;
  private motion: CameraMotion | null = null;
  private lastView: RideView | null = null;
  private readonly cleanups: (() => void)[] = [];
  private readonly monitor = new FrameRateMonitor();

  constructor() {
    afterNextRender(() => void this.init());
    effect(() => {
      this.view();
      this.motion = null;
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.dispose();
    });
  }

  private async init(): Promise<void> {
    try {
      // Probe a separate canvas so a WebGL1 context can never be accidentally reused by Cesium.
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
      if (!gl) {
        this.fail('unavailable');
        return;
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      const baseUrl = new URL('cesium/', document.baseURI).href;
      (window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = baseUrl;
      if (!document.querySelector('link[data-cesium-css]')) {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = `${baseUrl}Widgets/widgets.css`;
        css.dataset['cesiumCss'] = '';
        document.head.append(css);
      }
      const c = await import('cesium');
      if (this.destroyed) return;
      c.Ion.defaultAccessToken = '';
      const terrain = await deadline(
        c.CesiumTerrainProvider.fromUrl(SCENE_SOURCES.terrain, {
          requestVertexNormals: false,
          credit: new c.Credit('© swisstopo', true),
        }),
      );
      if (this.destroyed) return;
      this.zone.runOutsideAngular(() => this.createViewer(c, terrain));
    } catch {
      this.fail('unavailable');
    }
  }

  private createViewer(c: typeof Cesium, terrain: Cesium.CesiumTerrainProvider): void {
    const settings = QUALITY[this.quality()];
    const viewer = new c.Viewer(this.container().nativeElement, {
      baseLayer: false,
      terrainProvider: terrain,
      geocoder: false,
      baseLayerPicker: false,
      animation: false,
      timeline: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      scene3DOnly: true,
      shouldAnimate: false,
      shadows: false,
      skyBox: false, // Daylight atmosphere suffices; no external star imagery.
      creditContainer: this.credits().nativeElement,
      showRenderLoopErrors: false,
    });
    this.viewer = viewer;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.maximumScreenSpaceError = settings.screenSpaceError;
    viewer.resolutionScale = settings.resolution;
    viewer.useBrowserRecommendedResolution = this.quality() !== 'HIGH';
    viewer.scene.globe.baseColor = c.Color.fromCssColorString('#4e6553');
    // Keep streaming local to the view: no bulk prefetch of the public service.
    const imagery = new c.UrlTemplateImageryProvider({
      url: SCENE_SOURCES.imagery,
      maximumLevel: 20,
      rectangle: c.Rectangle.fromDegrees(5.140242, 45.398181, 11.47757, 48.230651),
      credit: new c.Credit('© swisstopo', true),
    });
    viewer.imageryLayers.addImageryProvider(imagery);
    this.cleanups.push(viewer.scene.renderError.addEventListener(() => this.fail('unavailable')));
    const contextLost = (event: Event) => {
      event.preventDefault();
      this.fail('unavailable');
    };
    viewer.canvas.addEventListener('webglcontextlost', contextLost);
    this.cleanups.push(() => viewer.canvas.removeEventListener('webglcontextlost', contextLost));
    let sourceErrors = 0;
    let lastSourceErrorAt = 0;
    const sourceError = () => {
      const now = performance.now();
      if (now - lastSourceErrorAt > 10_000) sourceErrors = 0;
      lastSourceErrorAt = now;
      if (++sourceErrors >= 3) this.fail('unavailable');
    };
    this.cleanups.push(terrain.errorEvent.addEventListener(sourceError));
    this.cleanups.push(imagery.errorEvent.addEventListener(sourceError));

    // Phase A uses an original rear-view cyclist marker; the animated glTF model belongs to phase B.
    const avatar = this.auth.me()?.profile.avatar;
    const rider = viewer.entities.add({
      position: new c.ConstantPositionProperty(),
      billboard: {
        image: cyclistImage(
          avatar?.jerseyColor ?? '#ff9800',
          avatar?.helmetColor ?? '#fafafa',
          avatar?.bikeColor ?? '#263238',
        ),
        width: 1.05,
        height: 1.8,
        sizeInMeters: true,
        verticalOrigin: c.VerticalOrigin.BOTTOM,
      },
    });
    let lastFrame = performance.now();
    let pedalPhase = 0;
    let previousPoint: { lon: number; lat: number; cameraHeading: number } | null = null;
    const riderPosition = new c.Cartesian3();
    const draw = () => {
      if (this.destroyed || this.failed) return;
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      const p = this.session.position();
      if (!p) return;
      if (
        previousPoint &&
        (Math.abs(turn(previousPoint.cameraHeading, p.cameraHeading)) > 120 ||
          distance([previousPoint.lon, previousPoint.lat], [p.lon, p.lat]) > 20)
      )
        this.motion = null;
      previousPoint = p;
      pedalPhase +=
        (this.session.paused() ? 0 : this.session.hud().cadence / 60) * Math.PI * 2 * dt;
      const ground = (q: ScenePoint) =>
        viewer.scene.globe.getHeight(c.Cartographic.fromDegrees(q.lon, q.lat));
      const road = aboveGround(p, ground(p), 0.05);
      const ahead = this.view() === 'FIRST_PERSON' ? p.firstLookAhead : p.lookAhead;
      const lookAheadPoint = aboveGround(ahead, ground(ahead), 0.05);
      const desired =
        this.view() === 'FIRST_PERSON'
          ? firstPersonPose(road, p.cameraHeading, lookAheadPoint, {
              headBobEnabled: this.headBobEnabled(),
              pedalPhase,
            })
          : thirdPersonPose(road, p.cameraHeading, p.grade, { lookAheadPoint });
      const cameraGround = ground(desired.position);
      if (cameraGround !== undefined && desired.position.ele < cameraGround + 0.35) {
        const safe = aboveGround(desired.position, cameraGround);
        const targetDistance = distance(
          [safe.lon, safe.lat],
          [desired.target.lon, desired.target.lat],
        );
        desired.position = safe;
        desired.pitchDeg = c.Math.toDegrees(
          Math.atan2(desired.target.ele - safe.ele, Math.max(0.1, targetDistance)),
        );
      }
      if (!this.motion || this.lastView !== this.view()) this.motion = startMotion(desired);
      this.lastView = this.view();
      const smoothed = smoothPose(this.motion, desired, dt);
      // Check at the smoothed coordinates too: a curve can cross higher terrain between two poses.
      const safe = aboveGround(smoothed.pose.position, ground(smoothed.pose.position));
      this.motion = smoothed.motion;
      if (safe.ele > this.motion.ele.value) this.motion.ele = { value: safe.ele, velocity: 0 };
      viewer.camera.setView({
        destination: c.Cartesian3.fromDegrees(safe.lon, safe.lat, safe.ele),
        orientation: {
          heading: c.Math.toRadians(smoothed.pose.headingDeg),
          pitch: c.Math.toRadians(smoothed.pose.pitchDeg),
          roll: c.Math.toRadians(desired.rollDeg),
        },
      });
      const frustum = viewer.camera.frustum as Cesium.PerspectiveFrustum;
      frustum.fov = frustumFov(desired.fovDeg, frustum.aspectRatio ?? 1);
      c.Cartesian3.fromDegrees(road.lon, road.lat, road.ele, undefined, riderPosition);
      (rider.position as Cesium.ConstantPositionProperty).setValue(riderPosition);
      rider.show = this.view() === 'THIRD_PERSON';
    };
    draw();
    this.cleanups.push(viewer.scene.preRender.addEventListener(draw));
    const onVisibility = () => {
      this.monitor.reset();
      this.motion = null;
      lastFrame = performance.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    this.cleanups.push(
      viewer.scene.postRender.addEventListener(() => {
        if (this.monitor.frame(performance.now(), document.visibilityState === 'visible'))
          this.fail('performance');
      }),
    );
    if (settings.buildings) {
      void deadline(
        c.Cesium3DTileset.fromUrl(SCENE_SOURCES.buildings, {
          maximumScreenSpaceError: settings.screenSpaceError,
          maximumCacheOverflowBytes: 64 * 1024 * 1024,
          cacheBytes: 64 * 1024 * 1024,
        }).then((tiles) => {
          // A timed-out load can still resolve later; release its GPU resources as well.
          if (this.destroyed || this.failed) tiles.destroy();
          return tiles;
        }),
      )
        .then((tiles) => {
          if (this.destroyed || this.failed) {
            if (!tiles.isDestroyed()) tiles.destroy();
            return;
          }
          tiles.style = new c.Cesium3DTileStyle({ color: "color('#e5dfd4')" });
          viewer.scene.primitives.add(tiles);
        })
        .catch(() => this.fail('unavailable'));
    }
    this.zone.run(() => this.loading.set(false));
  }

  private fail(reason: 'performance' | 'unavailable'): void {
    if (this.destroyed || this.failed) return;
    this.failed = true;
    // Defer destruction until outside a Cesium render/event callback.
    queueMicrotask(() => {
      this.dispose();
      if (!this.destroyed) this.zone.run(() => this.fallback.emit(reason));
    });
  }

  private dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.viewer && !this.viewer.isDestroyed()) this.viewer.destroy();
    this.viewer = null;
  }
}

async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('3D source timeout')), 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

function cyclistImage(jersey: string, helmet: string, bike: string): string {
  const color = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#ff9800');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="105" height="180" viewBox="0 0 105 180">
    <ellipse cx="52" cy="161" rx="10" ry="17" fill="#15191d" stroke="#bcc4c8" stroke-width="3"/>
    <path d="M52 150V100M32 110L52 135L73 110" fill="none" stroke="${color(bike)}" stroke-width="7"/>
    <path d="M36 94L32 127L42 149M68 94L73 127L63 149" fill="none" stroke="#222b35" stroke-width="13" stroke-linecap="round"/>
    <path d="M34 47Q52 37 70 47L74 96Q52 109 30 96Z" fill="${color(jersey)}" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
    <path d="M34 54L19 80L27 98M70 54L86 80L78 98" fill="none" stroke="#dba47f" stroke-width="9" stroke-linecap="round"/>
    <path d="M25 97H80" stroke="${color(bike)}" stroke-width="6" stroke-linecap="round"/>
    <ellipse cx="52" cy="28" rx="15" ry="18" fill="${color(helmet)}" stroke="#414a52" stroke-width="2"/>
    <path d="M45 13V36M58 13V36" stroke="#414a52" stroke-width="3"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
