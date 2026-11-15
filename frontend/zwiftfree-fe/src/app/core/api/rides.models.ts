import { FeatureCollection } from 'geojson';
import { RideEdgeEntry, RideSample } from '../../physics/ride-engine';

export type RideMode = 'TRAINER' | 'SIMULATOR';
export type RideStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
export type RideEventType =
  'PEE_BREAK_START' | 'PEE_BREAK_END' | 'CRASH' | 'RECOVERED' | 'SEGMENT_DONE' | 'PAUSE' | 'RESUME';

export interface RideSummary {
  id: string;
  routeId: string | null;
  routeName: string | null;
  startedAt: string;
  endedAt: string | null;
  status: RideStatus;
  mode: RideMode;
  distanceM: number | null;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
  ascentM: number | null;
  avgPower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  avgSpeedKmh: number | null;
  kj: number | null;
  tss: number | null;
  intensityFactor: number | null;
  peeBreaks: number;
  crashes: number;
}

export interface RideEvent {
  id: string;
  t: number;
  type: RideEventType;
  distanceM: number | null;
  payload?: Record<string, unknown> | null;
}

export interface RideDetail {
  ride: RideSummary;
  events: RideEvent[];
  /** personal records set by this ride when it was completed */
  records: NewRecord[];
  /** timed segments ridden in full */
  segmentEfforts: SegmentEffort[];
}

/** BEST_5S … BEST_60MIN (W), LONGEST_RIDE, MOST_ASCENT (m), or segment:<id> (s, lower is better). */
export type RecordMetric = string;

export interface NewRecord {
  metric: RecordMetric;
  value: number;
  previous: number | null;
}

export interface SegmentEffort {
  segmentId: string;
  name: string;
  type: 'CLIMB' | 'SPRINT';
  lengthM: number;
  avgGrade: number | null;
  elapsedS: number;
  avgPower: number | null;
  personalBest: boolean;
  rank: number;
}

export interface SamplesBatch {
  samples: RideSample[];
  edges: RideEdgeEntry[];
}

export interface SamplesColumns {
  t: number[];
  distanceM: number[];
  lat: (number | null)[];
  lon: (number | null)[];
  ele: (number | null)[];
  grade: (number | null)[];
  power: (number | null)[];
  cadence: (number | null)[];
  hr: (number | null)[];
  speedKmh: (number | null)[];
  avatarState: (string | null)[];
}

export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface Explored {
  exploredEdges: number;
  totalEdges: number;
  exploredKm: number;
  totalKm: number;
  percent: number;
  geojson: FeatureCollection;
}
