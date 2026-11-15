import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import { Coord3 } from '../../core/api/roads.models';
import { TurnChoice } from '../../physics/junctions';
import { TICINO_MAX_BOUNDS, emptyLine, lineFeature, ticinoStyle } from '../../shared/map/map-style';
import { FramePosition, RideSession } from './ride-session';

/** Zoom used while the zoom is locked: close enough to read the junction ahead. */
export const RIDE_ZOOM = 16;

/**
 * Live ride map: road network, planned route, ridden part, turn options and the rider, with a camera that follows
 * the rider every animation frame (optionally rotated to the direction of travel).
 */
@Component({
  selector: 'app-ride-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #container class="map" data-testid="ride-map"></div>`,
  styles: `
    :host {
      display: block;
      position: relative;
    }
    .map {
      position: absolute;
      inset: 0;
    }
    .map.shake {
      animation: shake 0.6s ease-in-out;
    }
    @keyframes shake {
      20% {
        transform: translate(-6px, 3px);
      }
      40% {
        transform: translate(5px, -4px);
      }
      60% {
        transform: translate(-4px, 2px);
      }
      80% {
        transform: translate(3px, -1px);
      }
    }
  `,
})
export class RideMap {
  readonly followHeading = input(true);
  readonly lockZoom = input(true);

  private readonly session = inject(RideSession);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly zone = inject(NgZone);
  private map: MlMap | null = null;
  private marker: Marker | null = null;
  private loaded = false;
  private markerEl: HTMLElement | null = null;
  private stopFrames: (() => void) | null = null;

  constructor() {
    afterNextRender(() => void this.init());
    inject(DestroyRef).onDestroy(() => {
      this.stopFrames?.();
      this.map?.remove();
    });
    effect(() => this.setLine('planned', this.session.plannedLine()));
    effect(() => this.setLine('ridden', this.session.riddenLine()));
    effect(() => this.showChoices(this.session.choices(), this.session.selected()));
    // The rider marker shows the avatar state; the map shakes briefly at every crash.
    effect(() => {
      const state = this.session.hud().state;
      this.markerEl?.setAttribute('data-state', state);
    });
    effect(() => {
      if (this.session.crashes() === 0) return;
      const el = this.container().nativeElement;
      el.classList.remove('shake');
      void el.offsetWidth; // restart the animation
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 700);
    });
  }

  private async init(): Promise<void> {
    const lib = await import('maplibre-gl');
    lib.setWorkerUrl(`${location.origin}/maplibre/maplibre-gl-worker.mjs`);
    const start = this.session.position();
    this.zone.runOutsideAngular(() => {
      const style = ticinoStyle(location.origin, 'grade');
      // The planned route reuses the style's "route" layers; ridden part and choices are added on top.
      style.sources['ridden'] = { type: 'geojson', data: emptyLine() };
      style.sources['choices'] = { type: 'geojson', data: emptyLine() };
      style.layers.push(
        {
          id: 'choices',
          type: 'line',
          source: 'choices',
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': ['case', ['get', 'selected'], '#00e5ff', '#ffffff'],
            'line-width': ['case', ['get', 'selected'], 8, 5],
            'line-opacity': ['case', ['get', 'selected'], 0.95, 0.55],
          },
        },
        {
          id: 'ridden',
          type: 'line',
          source: 'ridden',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ff6d00', 'line-width': 6 },
        },
      );
      const map = new lib.Map({
        container: this.container().nativeElement,
        style,
        center: start ? [start.lon, start.lat] : [8.95, 46.2],
        zoom: RIDE_ZOOM,
        pitch: 45,
        maxBounds: TICINO_MAX_BOUNDS as [number, number, number, number],
        attributionControl: { compact: false },
      });
      map.addControl(new lib.NavigationControl({ visualizePitch: true }), 'top-right');
      const el = document.createElement('div');
      el.className = 'rider-marker';
      this.markerEl = el;
      el.innerHTML = `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
          <circle cx="20" cy="20" r="11" fill="#ff6d00" stroke="#fff" stroke-width="3"/>
          <path d="M20 3 L27 15 L13 15 Z" fill="#fff"/></svg>`;
      this.marker = new lib.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat(start ? [start.lon, start.lat] : [8.95, 46.2])
        .addTo(map);
      map.on('load', () => {
        this.loaded = true;
        this.setLine('planned', this.session.plannedLine());
        this.setLine('ridden', this.session.riddenLine());
        this.showChoices(this.session.choices(), this.session.selected());
        if (start) this.follow(start);
      });
      this.map = map;
      this.stopFrames = this.session.onFrame((p) => this.follow(p));
    });
  }

  private follow(p: FramePosition): void {
    const map = this.map;
    if (!map) return;
    this.marker?.setLngLat([p.lon, p.lat]).setRotation(p.heading);
    map.jumpTo({
      center: [p.lon, p.lat],
      bearing: this.followHeading() ? p.heading : map.getBearing(),
      zoom: this.lockZoom() ? RIDE_ZOOM : map.getZoom(),
    });
  }

  private setLine(source: 'planned' | 'ridden', coords: Coord3[] | null): void {
    if (!this.loaded || !this.map) return;
    const src = this.map.getSource(source === 'planned' ? 'route' : 'ridden') as GeoJSONSource;
    src?.setData(coords && coords.length > 1 ? lineFeature(coords) : emptyLine());
  }

  /** The first ~120 m of each way out of the coming junction; the selected one is highlighted. */
  private showChoices(choices: TurnChoice[], selected: number): void {
    if (!this.loaded || !this.map) return;
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: choices.map((c, i) => {
        const pts = c.direction === 1 ? c.edge.coordinates : [...c.edge.coordinates].reverse();
        return {
          type: 'Feature',
          properties: { selected: i === selected },
          geometry: { type: 'LineString', coordinates: pts.slice(0, 13).map((q) => [q[0], q[1]]) },
        };
      }),
    };
    (this.map.getSource('choices') as GeoJSONSource)?.setData(fc);
  }
}
