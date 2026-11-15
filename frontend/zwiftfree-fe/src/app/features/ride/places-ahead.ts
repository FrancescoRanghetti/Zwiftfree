import { Place } from '../../core/api/roads.models';
import { Course } from '../../physics/course';
import { bearing, distance, turn } from '../../physics/geo';

export interface PlaceAhead {
  name: string;
  /** metres to go (along the route when known, otherwise as the crow flies) */
  distanceM: number;
}

/** Places within `maxOffM` of a planned course, with the course distance where the rider passes them. */
export function placesAlong(
  course: Course,
  places: Place[],
  maxOffM = 400,
): { name: string; atM: number }[] {
  const len = course.lengthM;
  const samples: { m: number; p: [number, number] }[] = [];
  for (let m = 0; m <= len; m += 100) {
    const pt = course.pointAt(m);
    samples.push({ m, p: [pt.lon, pt.lat] });
  }
  const out: { name: string; atM: number }[] = [];
  for (const place of places) {
    let best = Infinity;
    let at = 0;
    for (const s of samples) {
      const d = distance(s.p, [place.lon, place.lat]);
      if (d < best) {
        best = d;
        at = s.m;
      }
    }
    if (best <= maxOffM) out.push({ name: place.name, atM: at });
  }
  return out.sort((a, b) => a.atM - b.atM);
}

/** Next place on a planned course after `distanceM` (skipping the one the rider is in). */
export function nextAlong(
  along: { name: string; atM: number }[],
  distanceM: number,
): PlaceAhead | null {
  const next = along.find((p) => p.atM > distanceM + 150);
  return next ? { name: next.name, distanceM: next.atM - distanceM } : null;
}

/** Free ride: the nearest place roughly ahead (within ±45° of the heading, up to 8 km). */
export function nextInFront(
  places: Place[],
  pos: { lat: number; lon: number },
  headingDeg: number,
  maxM = 8000,
): PlaceAhead | null {
  let best: PlaceAhead | null = null;
  const here: [number, number] = [pos.lon, pos.lat];
  for (const p of places) {
    const there: [number, number] = [p.lon, p.lat];
    const d = distance(here, there);
    if (d < 300 || d > maxM) continue;
    if (Math.abs(turn(headingDeg, bearing(here, there))) > 45) continue;
    if (!best || d < best.distanceM) best = { name: p.name, distanceM: d };
  }
  return best;
}
