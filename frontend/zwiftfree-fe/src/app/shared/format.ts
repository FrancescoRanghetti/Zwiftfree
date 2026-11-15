import { POWER_RECORDS, SEGMENT_PREFIX } from '../core/api/stats.models';
import { formatKm, formatM } from './grade';

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Short label of a duration for charts: 5 → "5 s", 120 → "2 min", 3600 → "60 min". */
export function durationLabel(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** Record value with its unit: W for power, km for the longest ride, m for climbing, time for segments. */
export function formatRecordValue(metric: string, value: number): string {
  if (metric in POWER_RECORDS) return `${Math.round(value)} W`;
  if (metric === 'LONGEST_RIDE') return `${formatKm(value)} km`;
  if (metric === 'MOST_ASCENT') return `${formatM(value)} m`;
  if (metric.startsWith(SEGMENT_PREFIX)) return formatDuration(value);
  return String(value);
}
