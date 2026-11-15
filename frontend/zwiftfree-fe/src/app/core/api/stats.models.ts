import { RideSummary } from './rides.models';

export type StatsPeriod = 'week' | 'month' | 'year' | 'all';

export interface StatsSummary {
  period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';
  /** start of the period, null for ALL */
  from: string | null;
  rides: number;
  distanceM: number;
  movingTimeS: number;
  ascentM: number;
  kj: number;
  tss: number;
  peeBreaks: number;
  crashes: number;
  /** rides in which a Monte Ceneri climb was completed */
  ceneri: number;
  lastRide: RideSummary | null;
}

export interface CurvePoint {
  durationS: number;
  watts: number | null;
  rideId: string | null;
  date: string | null;
}

export interface LoadDay {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface SegmentRef {
  id: string;
  name: string;
  type: 'CLIMB' | 'SPRINT';
  lengthM: number;
  avgGrade: number | null;
}

export interface PersonalRecord {
  metric: string;
  value: number;
  rideId: string | null;
  achievedAt: string;
  segment: SegmentRef | null;
}

export interface BoardEntry {
  rideId: string;
  elapsedS: number;
  avgPower: number | null;
  date: string;
}

export interface SegmentBoard {
  segmentId: string;
  name: string;
  type: 'CLIMB' | 'SPRINT';
  startM: number;
  lengthM: number;
  avgGrade: number;
  efforts: BoardEntry[];
}

/** Power records and their duration in seconds (as on the backend). */
export const POWER_RECORDS: Record<string, number> = {
  BEST_5S: 5,
  BEST_1MIN: 60,
  BEST_5MIN: 300,
  BEST_20MIN: 1200,
  BEST_60MIN: 3600,
};

export const SEGMENT_PREFIX = 'segment:';
