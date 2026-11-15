export type PlanProfile = 'SHORTEST' | 'AVOID_CLIMBS' | 'SEEK_CLIMBS' | 'QUIET';

export const PLAN_PROFILES: readonly PlanProfile[] = [
  'SHORTEST',
  'AVOID_CLIMBS',
  'SEEK_CLIMBS',
  'QUIET',
];

export interface LatLon {
  lat: number;
  lon: number;
}

/** [lon, lat, ele] */
export type Coord3 = [number, number, number];
/** [distanceM, ele, gradePercent] every ~50 m */
export type ProfilePoint = [number, number, number];

export interface PlanResult {
  edgeIds: number[];
  directions: (1 | -1)[];
  /** distance along the route where each edge starts */
  edgeStartsM: number[];
  coordinates: Coord3[];
  profile: ProfilePoint[];
  lengthM: number;
  ascentM: number;
  descentM: number;
  minEle: number;
  maxEle: number;
  maxGrade: number;
  loop: boolean;
  roadNames: string[];
}

export interface Place {
  id: number;
  name: string;
  kind: 'city' | 'town' | 'village' | 'hamlet';
  population: number | null;
  lat: number;
  lon: number;
}

export interface RouteSummary {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  official: boolean;
  mine: boolean;
  isPublic: boolean;
  lengthM: number;
  ascentM: number;
  descentM: number;
  minEle: number;
  maxEle: number;
  maxGrade: number;
  loop: boolean;
  profile: PlanProfile | null;
  createdAt: string;
  /** simplified [lon, lat] track */
  preview: [number, number][];
}

export interface SegmentOnRoute {
  id: string;
  name: string;
  type: 'CLIMB' | 'SPRINT';
  startM: number;
  endM: number;
  lengthM: number;
  avgGrade: number;
  ascentM: number;
}

export interface RouteDetail {
  summary: RouteSummary;
  edgeIds: number[];
  directions: (1 | -1)[];
  /** null when the network was re-imported and the edges no longer match the stored track */
  edgeStartsM: number[] | null;
  coordinates: Coord3[];
  elevationProfile: ProfilePoint[];
  segments: SegmentOnRoute[];
}

export interface CreateRoute {
  name: string;
  description?: string;
  isPublic: boolean;
  edgeIds: number[];
  directions: number[];
  profile?: PlanProfile;
}

/** A road segment between two junctions (GET /api/roads/edges/{id}, /api/roads/area). */
export interface RoadEdge {
  id: number;
  source: number;
  target: number;
  name: string | null;
  highway: string | null;
  surface: string | null;
  oneway: number;
  rank: number;
  lengthM: number;
  ascentM: number;
  descentM: number;
  avgGrade: number;
  maxGrade: number;
  minGrade: number;
  forwardAllowed: boolean;
  backwardAllowed: boolean;
  /** source → target, one point every ~10 m */
  coordinates: Coord3[];
}

export interface Nearest {
  node: { id: number; lat: number; lon: number; ele: number; distanceM: number };
  edge: {
    id: number;
    name: string | null;
    highway: string | null;
    distanceM: number;
    fraction: number;
  };
}
