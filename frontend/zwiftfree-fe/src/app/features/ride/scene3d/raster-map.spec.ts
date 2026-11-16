import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RideMap } from '../ride-map';
import { RideSession } from '../ride-session';
import { RasterRideMap, mercatorPixel, visibleTiles } from './raster-map';

describe('emergency raster map projection', () => {
  it('uses the north-west origin and 256-pixel WMTS tiles', () => {
    expect(mercatorPixel(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(mercatorPixel(-180, 0, 0).x).toBe(0);
    expect(mercatorPixel(180, 0, 0).x).toBe(256);
    expect(mercatorPixel(0, 90, 0).y).toBeCloseTo(0, 8);
    expect(mercatorPixel(0, -90, 0).y).toBeCloseTo(256, 8);
  });

  it('preserves direction and doubles world pixels at each zoom', () => {
    const lugano = mercatorPixel(8.9511, 46.0037, 16);
    expect(mercatorPixel(8.9521, 46.0037, 16).x).toBeGreaterThan(lugano.x);
    expect(mercatorPixel(8.9511, 46.0047, 16).y).toBeLessThan(lugano.y);
    const nextZoom = mercatorPixel(8.9511, 46.0037, 17);
    expect(nextZoom.x).toBeCloseTo(2 * lugano.x);
    expect(nextZoom.y).toBeCloseTo(2 * lugano.y);
  });

  it('covers a rotated viewport and limits tile rows to the world extent', () => {
    const center = { x: 4096, y: 4096 };
    const north = visibleTiles(center, 1024, 128, 5, 0);
    const east = visibleTiles(center, 1024, 128, 5, 90);
    expect(new Set(east.map((tile) => tile.x)).size).toBeLessThan(
      new Set(north.map((tile) => tile.x)).size,
    );
    expect(new Set(east.map((tile) => tile.y)).size).toBeGreaterThan(
      new Set(north.map((tile) => tile.y)).size,
    );
    const polar = visibleTiles({ x: 0, y: 0 }, 1024, 768, 2, 45);
    expect(polar.every((tile) => tile.y >= 0 && tile.y < 4)).toBe(true);
  });
});

describe('DOM raster ride map without WebGL', () => {
  it('recovers the ride map when a WebGL2 context cannot be created', async () => {
    const stopFrames = vi.fn();
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      await TestBed.configureTestingModule({
        imports: [RideMap],
        providers: [
          {
            provide: RideSession,
            useValue: {
              plannedLine: signal([
                [9, 46, 200],
                [9.001, 46, 201],
              ]),
              riddenLine: signal([]),
              choices: signal([]),
              selected: signal(-1),
              crashes: signal(0),
              hud: signal({ state: 'IDLE' }),
              position: () => ({ lon: 9, lat: 46, heading: 0, distanceM: 0 }),
              onFrame: () => stopFrames,
            },
          },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(RideMap);
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('[data-testid="ride-map-raster"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
      fixture.destroy();
      expect(stopFrames).toHaveBeenCalledOnce();
    } finally {
      context.mockRestore();
    }
  });

  it('follows the rider with bounded raster tiles and SVG tracks, then removes its DOM', () => {
    const container = document.createElement('div');
    Object.defineProperties(container, {
      clientWidth: { value: 640 },
      clientHeight: { value: 480 },
    });
    document.body.append(container);
    const map = new RasterRideMap(container, 16);
    const position = { lon: 9, lat: 46, heading: 90 };
    map.follow(position, true);
    map.setLine('planned', [
      [9, 46, 200],
      [9.001, 46, 201],
    ]);
    map.setLine('ridden', [
      [9, 46, 200],
      [9.0005, 46, 200.5],
    ]);
    const root = container.querySelector<HTMLElement>('[data-testid="ride-map-raster"]')!;
    expect(root).not.toBeNull();
    expect(root.querySelectorAll('canvas')).toHaveLength(0);
    expect(root.querySelectorAll('img').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('img').length).toBeLessThan(50);
    expect(root.querySelector('img')?.src).toMatch(
      /ch.swisstopo.pixelkarte-farbe\/default\/current\/3857\/16\/\d+\/\d+\.jpeg$/,
    );
    expect(root.querySelector('a')?.textContent).toBe('© swisstopo');
    expect(
      root.querySelector('polyline[stroke="#6a1b9a"]')?.getAttribute('points')?.split(' '),
    ).toHaveLength(2);
    expect(
      root.querySelector('polyline[stroke="#ff6d00"]')?.getAttribute('points')?.split(' '),
    ).toHaveLength(2);
    expect(map.marker.style.transform).toContain('rotate(0deg)');
    map.follow(position, false);
    expect(map.marker.style.transform).toContain('rotate(90deg)');
    map.follow({ ...position, lon: 9.1 }, false);
    expect(root.querySelectorAll('img').length).toBeLessThan(50);
    map.destroy();
    window.dispatchEvent(new Event('resize'));
    expect(container.children).toHaveLength(0);
    container.remove();
  });
});
