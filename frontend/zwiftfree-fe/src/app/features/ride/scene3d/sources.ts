/** Public swisstopo services, metadata and CORS verified on 2026-11-16. */
export const SCENE_SOURCES = {
  terrain: 'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/',
  imagery:
    'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
  buildings: 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json',
} as const;

export const QUALITY = {
  LOW: { screenSpaceError: 4, resolution: 0.75, buildings: false },
  MEDIUM: { screenSpaceError: 2, resolution: 1, buildings: true },
  HIGH: { screenSpaceError: 1.33, resolution: 1, buildings: true },
} as const;
