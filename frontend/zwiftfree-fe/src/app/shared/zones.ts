import { Me } from '../core/auth/auth.models';

/** Estimated max heart rate: the profile value, else 220 − age, else 190. */
export function maxHr(me: Me | null): number {
  const p = me?.profile;
  if (p?.maxHr) return p.maxHr;
  if (p?.birthYear) return 220 - (new Date().getFullYear() - p.birthYear);
  return 190;
}

/** Five zones by % of max heart rate: <60, 60–70, 70–80, 80–90, ≥90. 0 = no reading. */
export function hrZone(hr: number | null, max: number): number {
  if (!hr || !max) return 0;
  const pct = hr / max;
  if (pct < 0.6) return 1;
  if (pct < 0.7) return 2;
  if (pct < 0.8) return 3;
  if (pct < 0.9) return 4;
  return 5;
}

/** Upper bounds (% of FTP) of the seven classic power zones; Z7 is everything above 150%. */
export const POWER_ZONE_LIMITS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5] as const;

export const POWER_ZONE_COLORS = [
  '#9e9e9e',
  '#42a5f5',
  '#66bb6a',
  '#fdd835',
  '#ffa726',
  '#ef5350',
  '#ab47bc',
];

export const HR_ZONE_BAR_COLORS = ['#9e9e9e', '#42a5f5', '#66bb6a', '#ffa726', '#ef5350'];

/** 1–7 by % of FTP; 0 when there is no reading or no FTP. */
export function powerZone(power: number | null, ftp: number): number {
  if (power === null || power === undefined || !ftp) return 0;
  const pct = power / ftp;
  const i = POWER_ZONE_LIMITS.findIndex((limit) => pct < limit);
  return i === -1 ? 7 : i + 1;
}

/** Seconds spent in each zone (index 0 = zone 1), one value per second; readings with zone 0 are skipped. */
export function timeInZones(
  values: (number | null)[],
  zoneOf: (v: number | null) => number,
  zones: number,
): number[] {
  const out = new Array<number>(zones).fill(0);
  for (const v of values) {
    const z = zoneOf(v);
    if (z >= 1 && z <= zones) out[z - 1]++;
  }
  return out;
}
