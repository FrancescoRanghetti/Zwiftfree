import type { Feature, FeatureCollection } from 'geojson';
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import { GRADE_COLORS } from '../grade';

/** 'explored' greys the network so that the rider's explored roads (an overlay) stand out. */
export type RoadColorMode = 'grade' | 'type' | 'explored';

export const EXPLORED_COLOR = '#00e5ff';

/** Ticino with some margin, [west, south, east, north]. */
export const TICINO_BOUNDS: [number, number, number, number] = [8.38, 45.81, 9.17, 46.64];
export const TICINO_MAX_BOUNDS: [number, number, number, number] = [7.9, 45.55, 9.65, 46.9];

export const SWISSTOPO_TILES =
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg';

export const ROAD_TYPE_COLORS: { rank: number; color: string; labelKey: string }[] = [
  { rank: 2, color: '#d32f2f', labelKey: 'map.typeMain' },
  { rank: 3, color: '#f57c00', labelKey: 'map.typeSecondary' },
  { rank: 5, color: '#fbc02d', labelKey: 'map.typeMinor' },
  { rank: 7, color: '#7cb342', labelKey: 'map.typeLocal' },
  { rank: 9, color: '#90a4ae', labelKey: 'map.typeOther' },
];

export function roadColor(mode: RoadColorMode): ExpressionSpecification | string {
  if (mode === 'explored') return '#8a8a8a';
  if (mode === 'grade') {
    return [
      'step',
      ['get', 'steepest'],
      GRADE_COLORS.easy,
      3,
      GRADE_COLORS.moderate,
      6,
      GRADE_COLORS.hard,
      9,
      GRADE_COLORS.steep,
    ];
  }
  return [
    'step',
    ['get', 'rank'],
    ROAD_TYPE_COLORS[0].color,
    3,
    ROAD_TYPE_COLORS[1].color,
    4,
    ROAD_TYPE_COLORS[2].color,
    6,
    ROAD_TYPE_COLORS[3].color,
    8,
    ROAD_TYPE_COLORS[4].color,
  ];
}

const ROAD_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  ['case', ['<=', ['get', 'rank'], 2], 1.6, 0.8],
  12,
  ['case', ['<=', ['get', 'rank'], 3], 3, 1.6],
  15,
  ['case', ['<=', ['get', 'rank'], 4], 6, 3.5],
  18,
  ['case', ['<=', ['get', 'rank'], 4], 12, 8],
];

export function ticinoStyle(origin: string, mode: RoadColorMode): StyleSpecification {
  return {
    version: 8,
    sources: {
      swisstopo: {
        type: 'raster',
        tiles: [SWISSTOPO_TILES],
        tileSize: 256,
        maxzoom: 18,
        attribution:
          '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noopener">swisstopo</a>',
      },
      roads: {
        type: 'vector',
        tiles: [`${origin}/api/tiles/roads/{z}/{x}/{y}.mvt`],
        minzoom: 8,
        maxzoom: 16,
        bounds: TICINO_BOUNDS,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      },
      route: { type: 'geojson', data: emptyLine() },
      explored: { type: 'geojson', data: emptyLine() },
    },
    layers: [
      {
        id: 'swisstopo',
        type: 'raster',
        source: 'swisstopo',
        paint: { 'raster-saturation': -0.25, 'raster-brightness-max': 0.9 },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'roads',
        'source-layer': 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': roadColor(mode), 'line-width': ROAD_WIDTH, 'line-opacity': 0.85 },
      },
      {
        id: 'explored',
        type: 'line',
        source: 'explored',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': EXPLORED_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 15, 6],
        },
      },
      {
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 15, 11],
        },
      },
      {
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#6a1b9a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 15, 7],
        },
      },
    ],
  };
}

export function emptyLine(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

export function lineFeature(coords: [number, number, number][] | [number, number][]): Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords.map((c) => [c[0], c[1]]) },
  };
}
