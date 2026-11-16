import { Coord3 } from '../../../core/api/roads.models';
import { TurnChoice } from '../../../physics/junctions';
import { SWISSTOPO_TILES } from '../../../shared/map/map-style';

const TILE_SIZE = 256;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_LATITUDE = 85.0511287798066;

export interface PixelPoint {
  x: number;
  y: number;
}

/** WMTS EPSG:3857 pixels, with the origin in the north-west corner of the world. */
export function mercatorPixel(lon: number, lat: number, zoom: number): PixelPoint {
  const size = TILE_SIZE * 2 ** zoom;
  const latitude = (Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: Math.max(0, Math.min(size, ((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2) * size)),
  };
}

/** Covers the rotated viewport, with one tile of margin for smooth following between tile boundaries. */
export function visibleTiles(
  center: PixelPoint,
  width: number,
  height: number,
  zoom: number,
  bearing: number,
): { x: number; y: number }[] {
  const angle = (bearing * Math.PI) / 180;
  const halfWidth = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2;
  const halfHeight = (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2;
  const lastTile = 2 ** zoom - 1;
  const tiles: { x: number; y: number }[] = [];
  for (
    let y = Math.max(0, Math.floor((center.y - halfHeight) / TILE_SIZE) - 1);
    y <= Math.min(lastTile, Math.floor((center.y + halfHeight) / TILE_SIZE) + 1);
    y++
  ) {
    for (
      let x = Math.floor((center.x - halfWidth) / TILE_SIZE) - 1;
      x <= Math.floor((center.x + halfWidth) / TILE_SIZE) + 1;
      x++
    ) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/** Minimal DOM/SVG map for devices unable to create MapLibre's WebGL2 context. */
export class RasterRideMap {
  readonly marker = document.createElement('div');
  private readonly root = document.createElement('div');
  private readonly stage = document.createElement('div');
  private readonly tileLayer = document.createElement('div');
  private readonly svg = document.createElementNS(SVG_NS, 'svg');
  private readonly choices = document.createElementNS(SVG_NS, 'g');
  private readonly plannedCasing = this.polyline('#ffffff', 10);
  private readonly planned = this.polyline('#6a1b9a', 6);
  private readonly ridden = this.polyline('#ff6d00', 6);
  private readonly attribution = document.createElement('a');
  private readonly tiles = new Map<string, HTMLImageElement>();
  private readonly resizeObserver: ResizeObserver | null;
  private position: { lon: number; lat: number; heading: number } | null = null;
  private followHeading = true;
  private width = 0;
  private height = 0;
  private tileSignature = '';
  private destroyed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly zoom: number,
  ) {
    this.root.dataset['testid'] = 'ride-map-raster';
    this.root.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#dae1da';
    this.stage.style.cssText = 'position:absolute;inset:0;transform-origin:center';
    this.tileLayer.style.cssText = 'position:absolute;left:50%;top:50%';
    this.svg.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none';
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.append(this.plannedCasing, this.planned, this.choices, this.ridden);
    this.stage.append(this.tileLayer, this.svg);
    this.marker.className = 'rider-marker';
    this.marker.style.cssText = 'position:absolute;left:50%;top:50%;width:40px;height:40px';
    this.marker.innerHTML =
      '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="11" fill="#ff6d00" stroke="#fff" stroke-width="3"/><path d="M20 3L27 15H13Z" fill="#fff"/></svg>';
    this.attribution.href = 'https://www.swisstopo.admin.ch/';
    this.attribution.target = '_blank';
    this.attribution.rel = 'noopener noreferrer';
    this.attribution.textContent = '© swisstopo';
    this.attribution.style.cssText =
      'position:absolute;left:8px;z-index:1;background:#121212bb;color:#fff;padding:2px 6px;font:11px sans-serif';
    this.root.append(this.stage, this.marker, this.attribution);
    container.append(this.root);
    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.resize);
    this.resizeObserver?.observe(container);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  follow(position: { lon: number; lat: number; heading: number }, followHeading: boolean): void {
    this.position = position;
    this.followHeading = followHeading;
    this.draw();
  }

  setLine(source: 'planned' | 'ridden', coordinates: Coord3[] | null): void {
    const points = this.points(coordinates ?? []);
    if (source === 'planned') {
      this.planned.setAttribute('points', points);
      this.plannedCasing.setAttribute('points', points);
    } else this.ridden.setAttribute('points', points);
  }

  showChoices(choices: TurnChoice[], selected: number): void {
    this.choices.replaceChildren(
      ...choices.map((choice, index) => {
        const pts =
          choice.direction === 1 ? choice.edge.coordinates : [...choice.edge.coordinates].reverse();
        const line = this.polyline(
          index === selected ? '#00e5ff' : '#ffffff',
          index === selected ? 8 : 5,
        );
        line.setAttribute('points', this.points(pts.slice(0, 13)));
        return line;
      }),
    );
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.resize);
    this.tiles.clear();
    this.root.remove();
  }

  private readonly resize = (): void => {
    if (this.destroyed) return;
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.attribution.style.bottom = window.innerWidth <= 700 ? '144px' : '184px';
    this.tileSignature = '';
    this.draw();
  };

  private draw(): void {
    if (!this.position || this.destroyed) return;
    const center = mercatorPixel(this.position.lon, this.position.lat, this.zoom);
    const bearing = this.followHeading ? this.position.heading : 0;
    const anchorX = Math.floor(center.x / TILE_SIZE);
    const anchorY = Math.floor(center.y / TILE_SIZE);
    this.stage.style.transform = `rotate(${-bearing}deg)`;
    this.tileLayer.style.transform = `translate(${anchorX * TILE_SIZE - center.x}px,${anchorY * TILE_SIZE - center.y}px)`;
    this.svg.setAttribute(
      'viewBox',
      `${center.x - this.width / 2} ${center.y - this.height / 2} ${this.width} ${this.height}`,
    );
    this.marker.style.transform = `translate(-50%,-50%) rotate(${this.position.heading - bearing}deg)`;
    const visible = visibleTiles(center, this.width, this.height, this.zoom, bearing);
    const signature = `${anchorX}/${anchorY}:` + visible.map(({ x, y }) => `${x}/${y}`).join(',');
    if (signature === this.tileSignature) return;
    this.tileSignature = signature;
    const wanted = new Set<string>();
    const count = 2 ** this.zoom;
    for (const { x, y } of visible) {
      const key = `${x}/${y}`;
      wanted.add(key);
      let tile = this.tiles.get(key);
      if (!tile) {
        tile = document.createElement('img');
        tile.alt = '';
        tile.draggable = false;
        tile.width = TILE_SIZE;
        tile.height = TILE_SIZE;
        tile.style.cssText = 'position:absolute;max-width:none;user-select:none';
        tile.src = SWISSTOPO_TILES.replace('{z}', String(this.zoom))
          .replace('{x}', String(((x % count) + count) % count))
          .replace('{y}', String(y));
        this.tiles.set(key, tile);
        this.tileLayer.append(tile);
      }
      tile.style.left = `${(x - anchorX) * TILE_SIZE}px`;
      tile.style.top = `${(y - anchorY) * TILE_SIZE}px`;
    }
    for (const [key, tile] of this.tiles) {
      if (!wanted.has(key)) {
        tile.remove();
        this.tiles.delete(key);
      }
    }
  }

  private points(coordinates: Coord3[]): string {
    return coordinates
      .map(([lon, lat]) => {
        const p = mercatorPixel(lon, lat, this.zoom);
        return `${p.x},${p.y}`;
      })
      .join(' ');
  }

  private polyline(color: string, width: number): SVGPolylineElement {
    const line = document.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', String(width));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    return line;
  }
}
