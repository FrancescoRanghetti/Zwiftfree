import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { FeatureCollection } from 'geojson';
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MlMap,
  MapGeoJSONFeature,
  Marker,
} from 'maplibre-gl';
import { Coord3, LatLon } from '../../core/api/roads.models';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatM } from '../grade';
import {
  RoadColorMode,
  TICINO_BOUNDS,
  TICINO_MAX_BOUNDS,
  emptyLine,
  lineFeature,
  roadColor,
  ticinoStyle,
} from './map-style';

/**
 * MapLibre map of Ticino: swisstopo raster below, road network vector tiles above, plus an optional route and
 * draggable numbered waypoints. MapLibre is loaded lazily so it never lands in the initial bundle.
 */
@Component({
  selector: 'app-ticino-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #container class="map" data-testid="map"></div>`,
  styles: `
    :host {
      display: block;
      position: relative;
    }
    .map {
      position: absolute;
      inset: 0;
    }
  `,
})
export class TicinoMap {
  readonly colorMode = input<RoadColorMode>('grade');
  readonly route = input<Coord3[] | null>(null);
  readonly waypoints = input<LatLon[]>([]);
  /** Extra lines drawn above the network (explored roads). */
  readonly overlay = input<FeatureCollection | null>(null);
  /** Fit the view to the route whenever it changes. */
  readonly fitRoute = input(true);
  /** 'waypoint': a click adds a point (right-click inspects a road). 'inspect': a click on a road shows its data. */
  readonly clickMode = input<'waypoint' | 'inspect'>('inspect');
  /** Embedded in a scrolling page: zoom with Ctrl/⌘ + wheel or two fingers, so the page can scroll. */
  readonly cooperative = input(false);
  /** Zoom to the overlay's roads whenever it changes (e.g. the explored-roads map on the stats page). */
  readonly fitOverlay = input(false);

  readonly mapClick = output<LatLon>();
  readonly waypointMoved = output<{ index: number; point: LatLon }>();

  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly zone = inject(NgZone);
  private readonly i18n = inject(I18nService);
  private map: MlMap | null = null;
  private markers: Marker[] = [];
  private lib: typeof import('maplibre-gl') | null = null;
  private loaded = false;

  constructor() {
    afterNextRender(() => void this.init());

    effect(() => {
      const mode = this.colorMode();
      if (this.loaded) this.map?.setPaintProperty('roads', 'line-color', roadColor(mode));
    });
    effect(() => {
      const route = this.route();
      const fit = this.fitRoute();
      if (this.loaded) this.showRoute(route, fit);
    });
    effect(() => {
      const fc = this.overlay();
      if (this.loaded) this.showOverlay(fc);
    });
    effect(() => {
      const wps = this.waypoints();
      if (this.loaded) this.showWaypoints(wps);
    });
  }

  flyTo(point: LatLon, zoom = 14): void {
    this.map?.flyTo({ center: [point.lon, point.lat], zoom });
  }

  private async init(): Promise<void> {
    const lib = await import('maplibre-gl');
    // The worker is copied to /maplibre by angular.json (bundlers cannot follow MapLibre's own worker URL).
    lib.setWorkerUrl(`${location.origin}/maplibre/maplibre-gl-worker.mjs`);
    this.lib = lib;
    this.zone.runOutsideAngular(() => {
      const map = new lib.Map({
        container: this.container().nativeElement,
        style: ticinoStyle(location.origin, this.colorMode()),
        bounds: TICINO_BOUNDS as LngLatBoundsLike,
        maxBounds: TICINO_MAX_BOUNDS as LngLatBoundsLike,
        minZoom: 7,
        maxZoom: 18,
        attributionControl: { compact: false },
        cooperativeGestures: this.cooperative(),
      });
      map.addControl(new lib.NavigationControl({ visualizePitch: true }), 'top-right');
      map.addControl(new lib.ScaleControl({ unit: 'metric' }), 'bottom-left');
      map.on('load', () => {
        this.loaded = true;
        // Inputs may have changed while the style was loading.
        map.setPaintProperty('roads', 'line-color', roadColor(this.colorMode()));
        this.showRoute(this.route(), this.fitRoute());
        this.showWaypoints(this.waypoints());
        this.showOverlay(this.overlay());
      });
      // Roads are thin lines: hit-test a small box around the pointer (finger-friendly).
      const roadsNear = (p: { x: number; y: number }) =>
        map.queryRenderedFeatures(
          [
            [p.x - 6, p.y - 6],
            [p.x + 6, p.y + 6],
          ],
          { layers: ['roads'] },
        );
      map.on('click', (e) => {
        if (this.clickMode() === 'inspect') {
          const roads = roadsNear(e.point);
          if (roads.length) this.roadPopup(roads[0], e.lngLat);
        }
        this.zone.run(() => this.mapClick.emit({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
      });
      map.on('contextmenu', (e) => {
        const roads = roadsNear(e.point);
        if (roads.length) this.roadPopup(roads[0], e.lngLat);
      });
      map.on('mouseenter', 'roads', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'roads', () => (map.getCanvas().style.cursor = ''));
      this.map = map;
    });
  }

  /** Name, length, climbing and steepest grade of a road; built with textContent (no HTML injection). */
  private roadPopup(f: MapGeoJSONFeature, at: { lng: number; lat: number }): void {
    if (!this.lib || !this.map) return;
    const p = f.properties as Record<string, string | number | undefined>;
    const box = document.createElement('div');
    box.className = 'road-popup';
    const title = document.createElement('strong');
    title.textContent = (p['name'] as string) || this.i18n.t('map.unnamedRoad');
    box.appendChild(title);
    const rows: [string, string][] = [
      [this.i18n.t('map.length'), `${formatM(Number(p['length_m'] ?? 0))} m`],
      [
        this.i18n.t('map.climb'),
        `+${formatM(Number(p['ascent_m'] ?? 0))} / −${formatM(Number(p['descent_m'] ?? 0))} m`,
      ],
      [this.i18n.t('map.maxGrade'), `${Number(p['steepest'] ?? 0).toFixed(1)}%`],
    ];
    for (const [k, v] of rows) {
      const line = document.createElement('div');
      line.textContent = `${k}: ${v}`;
      box.appendChild(line);
    }
    new this.lib.Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(at)
      .setDOMContent(box)
      .addTo(this.map);
  }

  private showOverlay(fc: FeatureCollection | null): void {
    (this.map?.getSource('explored') as GeoJSONSource | undefined)?.setData(fc ?? emptyLine());
    if (!fc || !this.fitOverlay() || !this.map || !this.lib) return;
    const b = new this.lib.LngLatBounds();
    let any = false;
    for (const f of fc.features) {
      const g = f.geometry;
      const lines =
        g.type === 'LineString'
          ? [g.coordinates]
          : g.type === 'MultiLineString'
            ? g.coordinates
            : [];
      for (const line of lines) {
        for (const c of line) {
          b.extend([c[0], c[1]]);
          any = true;
        }
      }
    }
    if (any) {
      this.map.fitBounds(b, { padding: 40, maxZoom: 14, animate: false });
    }
  }

  private showRoute(route: Coord3[] | null, fit: boolean): void {
    const map = this.map;
    if (!map || !this.lib) return;
    const src = map.getSource('route') as GeoJSONSource | undefined;
    if (!src) return;
    if (!route || route.length < 2) {
      src.setData(emptyLine());
      return;
    }
    src.setData(lineFeature(route));
    if (fit) {
      const b = new this.lib.LngLatBounds();
      for (const c of route) b.extend([c[0], c[1]]);
      map.fitBounds(b, { padding: { top: 60, bottom: 60, left: 60, right: 60 }, maxZoom: 15 });
    }
  }

  private showWaypoints(points: LatLon[]): void {
    if (!this.map || !this.lib) return;
    for (const m of this.markers) m.remove();
    this.markers = points.map((p, i) => {
      const el = document.createElement('div');
      el.className =
        'waypoint-marker' + (i === 0 ? ' start' : i === points.length - 1 ? ' end' : '');
      el.textContent = i === 0 ? 'A' : i === points.length - 1 ? 'B' : String(i);
      const marker = new this.lib!.Marker({ element: el, draggable: true })
        .setLngLat([p.lon, p.lat])
        .addTo(this.map!);
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        this.zone.run(() =>
          this.waypointMoved.emit({ index: i, point: { lat: ll.lat, lon: ll.lng } }),
        );
      });
      return marker;
    });
  }
}
