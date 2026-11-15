import { POWER_RECORDS } from '../../core/api/stats.models';

export interface RecordBeaten {
  metric: string;
  value: number;
}

/**
 * Spots personal records beaten during the ride, for a toast: best power over 5 s … 60 min and the longest ride.
 * Only records that already exist are watched (on the first rides everything would be a record), and each one is
 * announced once per ride. The backend decides the records that are actually stored.
 */
export class RecordWatch {
  private readonly windows: { metric: string; seconds: number; record: number; sum: number }[];
  private readonly power: number[] = [];
  private readonly announced = new Set<string>();
  private readonly longest: number | null;

  constructor(records: Record<string, number>) {
    this.windows = Object.entries(POWER_RECORDS)
      .filter(([metric]) => records[metric] > 0)
      .map(([metric, seconds]) => ({ metric, seconds, record: records[metric], sum: 0 }));
    this.longest = records['LONGEST_RIDE'] > 0 ? records['LONGEST_RIDE'] : null;
  }

  /** Feed one second of riding; returns the records beaten by it. */
  onSecond(power: number, distanceM: number): RecordBeaten[] {
    const p = Math.max(0, power || 0);
    this.power.push(p);
    const n = this.power.length;
    const out: RecordBeaten[] = [];
    for (const w of this.windows) {
      w.sum += p;
      if (n > w.seconds) w.sum -= this.power[n - 1 - w.seconds];
      if (n < w.seconds || this.announced.has(w.metric)) continue;
      const avg = Math.round(w.sum / w.seconds);
      if (avg > w.record) {
        this.announced.add(w.metric);
        out.push({ metric: w.metric, value: avg });
      }
    }
    if (this.longest !== null && distanceM > this.longest && !this.announced.has('LONGEST_RIDE')) {
      this.announced.add('LONGEST_RIDE');
      out.push({ metric: 'LONGEST_RIDE', value: distanceM });
    }
    return out;
  }
}
