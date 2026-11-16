import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { ME } from '../../core/auth/testing';
import { RideScene3d } from './ride-scene-3d';
import { RideSession } from './ride-session';

const cesium = vi.hoisted(() => ({ terrain: vi.fn(), viewer: vi.fn() }));

/** Only the GPU boundary is replaced: Angular lifecycle and renderer event handling run normally. */
vi.mock('cesium', () => ({
  Ion: { defaultAccessToken: '' },
  CesiumTerrainProvider: { fromUrl: cesium.terrain },
  Viewer: cesium.viewer,
  Credit: class {},
  Color: { fromCssColorString: () => ({}) },
  Rectangle: { fromDegrees: () => ({}) },
  Cartographic: { fromDegrees: (lon: number, lat: number) => ({ lon, lat }) },
  Cartesian3: class {
    lon = 0;
    lat = 0;
    ele = 0;

    static fromDegrees(
      lon: number,
      lat: number,
      ele: number,
      _ellipsoid?: unknown,
      result?: { lon: number; lat: number; ele: number },
    ) {
      return Object.assign(result ?? {}, { lon, lat, ele });
    }
  },
  ConstantPositionProperty: class {
    value: unknown;
    setValue(value: unknown): void {
      this.value = value;
    }
  },
  VerticalOrigin: { BOTTOM: 0 },
  Math: {
    toRadians: (degrees: number) => (degrees * Math.PI) / 180,
    toDegrees: (radians: number) => (radians * 180) / Math.PI,
  },
  UrlTemplateImageryProvider: class {
    errorEvent = event();
  },
}));

function event() {
  const listeners = new Set<() => void>();
  return {
    addEventListener(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fire: () => [...listeners].forEach((listener) => listener()),
    get size() {
      return listeners.size;
    },
  };
}

function viewer() {
  let destroyed = false;
  return {
    canvas: document.createElement('canvas'),
    scene: {
      screenSpaceCameraController: { enableInputs: true },
      globe: { getHeight: () => 200, maximumScreenSpaceError: 0, depthTestAgainstTerrain: false },
      renderError: event(),
      preRender: event(),
      postRender: event(),
    },
    entities: {
      add: vi.fn((options: { position: { setValue(value: unknown): void } }) => ({
        ...options,
        show: true,
      })),
    },
    imageryLayers: { addImageryProvider: vi.fn() },
    camera: { setView: vi.fn(), frustum: { fov: 0, aspectRatio: 16 / 9 } },
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => {
      destroyed = true;
    }),
  };
}

describe('RideScene3d lifecycle', () => {
  let fixture: ComponentFixture<RideScene3d> | undefined;
  let gpu: ReturnType<typeof viewer>;
  let terrain: { errorEvent: ReturnType<typeof event> };

  beforeEach(async () => {
    cesium.terrain.mockReset();
    cesium.viewer.mockReset();
    gpu = viewer();
    terrain = { errorEvent: event() };
    cesium.terrain.mockResolvedValue(terrain);
    cesium.viewer.mockImplementation(function () {
      return gpu;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: () => ({ loseContext: vi.fn() }),
    } as unknown as WebGL2RenderingContext);
    await TestBed.configureTestingModule({
      imports: [RideScene3d],
      providers: [
        { provide: AuthService, useValue: { me: signal(ME) } },
        {
          provide: RideSession,
          useValue: {
            phase: () => 'riding',
            position: () => ({
              lon: 9,
              lat: 46,
              ele: 200,
              heading: 0,
              cameraHeading: 0,
              grade: 0,
              distanceM: 0,
              lookAhead: { lon: 9, lat: 46.00018, ele: 200 },
              firstLookAhead: { lon: 9, lat: 46.00014, ele: 200 },
            }),
            hud: () => ({ cadence: 80 }),
            paused: () => false,
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    vi.restoreAllMocks();
  });

  async function mount() {
    fixture = TestBed.createComponent(RideScene3d);
    fixture.componentRef.setInput('quality', 'LOW');
    const fallback = vi.fn();
    fixture.componentInstance.fallback.subscribe(fallback);
    await fixture.whenStable();
    return fallback;
  }

  it('falls back without loading Cesium when WebGL2 is unavailable', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const fallback = await mount();
    expect(fallback).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(cesium.terrain).not.toHaveBeenCalled();
    expect(cesium.viewer).not.toHaveBeenCalled();
  });

  it('reports terrain initialization errors once', async () => {
    cesium.terrain.mockRejectedValue(new Error('Service unavailable'));
    const fallback = await mount();
    await vi.waitFor(() => expect(fallback).toHaveBeenCalledExactlyOnceWith('unavailable'));
    expect(cesium.viewer).not.toHaveBeenCalled();
  });

  it('does not create a viewer or emit after destruction during terrain loading', async () => {
    let resolve!: (value: typeof terrain) => void;
    cesium.terrain.mockReturnValue(
      new Promise<typeof terrain>((done) => {
        resolve = done;
      }),
    );
    const fallback = await mount();
    await vi.waitFor(() => expect(cesium.terrain).toHaveBeenCalledOnce());
    fixture!.destroy();
    resolve(terrain);
    await Promise.resolve();
    await Promise.resolve();
    expect(cesium.viewer).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(['renderError', 'contextLost'] as const)(
    'releases the GPU and emits fallback once after %s',
    async (failure) => {
      const fallback = await mount();
      await vi.waitFor(() => {
        fixture!.detectChanges();
        expect(
          fixture!.nativeElement
            .querySelector('[data-testid="ride-scene-3d"]')
            ?.getAttribute('data-ready'),
        ).toBe('true');
      });
      expect(cesium.viewer).toHaveBeenCalledOnce();
      expect(gpu.camera.setView).toHaveBeenCalledOnce();
      expect(fallback).not.toHaveBeenCalled();
      expect(gpu.destroy).not.toHaveBeenCalled();
      if (failure === 'renderError') gpu.scene.renderError.fire();
      else gpu.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      await vi.waitFor(() => expect(fallback).toHaveBeenCalledExactlyOnceWith('unavailable'));
      expect(gpu.destroy).toHaveBeenCalledOnce();
      expect(gpu.scene.preRender.size).toBe(0);
      expect(gpu.scene.postRender.size).toBe(0);
      expect(terrain.errorEvent.size).toBe(0);
      gpu.scene.renderError.fire();
      gpu.canvas.dispatchEvent(new Event('webglcontextlost'));
      await Promise.resolve();
      expect(fallback).toHaveBeenCalledOnce();
    },
  );
});
