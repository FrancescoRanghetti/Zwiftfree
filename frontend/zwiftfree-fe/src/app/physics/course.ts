import { Coord3, ProfilePoint } from '../core/api/roads.models';
import { bearing, cumulative, turnRadius } from './geo';

/** A stretch of road the rider follows: a whole edge, or part of one (start/end of a ride, turnaround). */
export interface CourseLeg {
  /** null for a route whose edges no longer match the network */
  edgeId: number | null;
  direction: 1 | -1;
  /** distance along the course where this leg starts */
  startM: number;
  lengthM: number;
  /** position along the edge, measured from its source node, at the start of the leg */
  edgeOffsetStartM: number;
  /** junction at the end of the leg, when known (free ride) */
  endNode: number | null;
  /** [lon, lat, ele] in travel order */
  pts: Coord3[];
  /** cumulative distance of each point inside the leg */
  cum: number[];
}

export type NewLeg = Omit<CourseLeg, 'startM' | 'lengthM' | 'cum'>;

export interface CoursePoint {
  lon: number;
  lat: number;
  ele: number;
  legIndex: number;
  edgeId: number | null;
  edgeOffsetM: number;
}

/**
 * The road ahead and behind as one line measured in metres from the start of the ride. Planned routes are known
 * in full; in free ride legs are appended at junctions (and the not-yet-entered one may be replaced).
 */
export class Course {
  readonly legs: CourseLeg[] = [];

  get lengthM(): number {
    const last = this.legs[this.legs.length - 1];
    return last ? last.startM + last.lengthM : 0;
  }

  append(leg: NewLeg): CourseLeg {
    const cum = cumulative(leg.pts);
    const full: CourseLeg = {
      ...leg,
      startM: this.lengthM,
      lengthM: cum[cum.length - 1] ?? 0,
      cum,
    };
    this.legs.push(full);
    return full;
  }

  /** Keeps only the first `count` legs. */
  truncate(count: number): void {
    this.legs.length = Math.max(0, Math.min(count, this.legs.length));
  }

  /** Shortens the leg containing `m` so that it ends exactly at `m`, and drops every leg after it. */
  cutAt(m: number): CourseLeg | null {
    if (!this.legs.length) return null;
    const i = this.legIndexAt(m);
    const leg = this.legs[i];
    const local = clamp(m - leg.startM, 0, leg.lengthM);
    const j = segmentIndex(leg.cum, local);
    const p = this.pointAt(m);
    const pts = leg.pts.slice(0, j + 1);
    if (local - leg.cum[j] > 0.01) pts.push([p.lon, p.lat, p.ele]);
    if (pts.length < 2) pts.push([p.lon, p.lat, p.ele]);
    const cum = cumulative(pts);
    this.legs[i] = { ...leg, pts, cum, lengthM: cum[cum.length - 1], endNode: null };
    this.truncate(i + 1);
    return this.legs[i];
  }

  legIndexAt(m: number): number {
    const legs = this.legs;
    let lo = 0;
    let hi = legs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (legs[mid].startM <= m) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  pointAt(m: number): CoursePoint {
    const legIndex = this.legIndexAt(m);
    const leg = this.legs[legIndex];
    const local = clamp(m - leg.startM, 0, leg.lengthM);
    const j = segmentIndex(leg.cum, local);
    const a = leg.pts[j];
    const b = leg.pts[Math.min(j + 1, leg.pts.length - 1)];
    const span = leg.cum[Math.min(j + 1, leg.cum.length - 1)] - leg.cum[j];
    const t = span > 0 ? (local - leg.cum[j]) / span : 0;
    return {
      lon: a[0] + (b[0] - a[0]) * t,
      lat: a[1] + (b[1] - a[1]) * t,
      ele: a[2] + (b[2] - a[2]) * t,
      legIndex,
      edgeId: leg.edgeId,
      edgeOffsetM: Math.max(0, leg.edgeOffsetStartM + leg.direction * local),
    };
  }

  eleAt(m: number): number {
    return this.pointAt(clamp(m, 0, this.lengthM)).ele;
  }

  /** Grade (%) over a window centred on m (spec: ~60 m, may cross into the next edge). */
  gradeAt(m: number, windowM = 60): number {
    const a = Math.max(0, m - windowM / 2);
    const b = Math.min(this.lengthM, m + windowM / 2);
    if (b - a < 5) return 0;
    return ((this.eleAt(b) - this.eleAt(a)) / (b - a)) * 100;
  }

  /** Direction of travel (degrees) around m, measured over ±span metres to smooth out polyline corners. */
  headingAt(m: number, span = 8): number {
    const len = this.lengthM;
    let a = Math.max(0, m - span);
    let b = Math.min(len, m + span);
    if (b - a < 1) {
      a = Math.max(0, b - 2 * span);
      b = Math.min(len, a + 2 * span);
    }
    const pa = this.pointAt(a);
    const pb = this.pointAt(b);
    return bearing([pa.lon, pa.lat], [pb.lon, pb.lat]);
  }

  /** Radius (m) of the bend around m, from the points ±span metres away; Infinity on a straight. */
  turnRadiusAt(m: number, span = 10): number {
    const len = this.lengthM;
    if (m - span < 0 || m + span > len) return Infinity;
    const a = this.pointAt(m - span);
    const b = this.pointAt(m);
    const c = this.pointAt(m + span);
    return turnRadius([a.lon, a.lat], [b.lon, b.lat], [c.lon, c.lat]);
  }

  /** Points between two distances (for drawing the ridden part), ends interpolated. */
  coordsBetween(from: number, to: number): Coord3[] {
    const out: Coord3[] = [];
    if (!this.legs.length || to <= from) return out;
    const start = this.pointAt(from);
    out.push([start.lon, start.lat, start.ele]);
    for (let i = start.legIndex; i < this.legs.length; i++) {
      const leg = this.legs[i];
      if (leg.startM > to) break;
      for (let k = 0; k < leg.pts.length; k++) {
        const d = leg.startM + leg.cum[k];
        if (d > from && d < to) out.push(leg.pts[k]);
      }
    }
    const end = this.pointAt(to);
    out.push([end.lon, end.lat, end.ele]);
    return out;
  }

  /** Elevation profile every `step` metres (same format as the backend's). */
  profile(step = 50): ProfilePoint[] {
    const total = this.lengthM;
    if (!this.legs.length) return [];
    const n = Math.max(2, Math.ceil(total / step) + 1);
    const out: ProfilePoint[] = [];
    let prevEle = this.eleAt(0);
    let prevD = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.min(total, i * step);
      const ele = this.eleAt(d);
      const grade = d > prevD ? ((ele - prevEle) / (d - prevD)) * 100 : 0;
      out.push([round1(d), round1(ele), round1(grade)]);
      prevEle = ele;
      prevD = d;
    }
    return out;
  }
}

/**
 * Splits a planned route into legs, one per edge. `edgeStartsM` comes from the backend and is matched to the
 * nearest coordinate; without it the whole route is one leg with no edge id.
 */
export function courseFromRoute(
  coords: Coord3[],
  edgeIds: number[],
  directions: (1 | -1)[],
  edgeStartsM: number[] | null,
): Course {
  const course = new Course();
  if (coords.length < 2) return course;
  if (!edgeStartsM || edgeStartsM.length !== edgeIds.length || !edgeIds.length) {
    course.append({
      edgeId: null,
      direction: 1,
      edgeOffsetStartM: 0,
      endNode: null,
      pts: coords,
    });
    return course;
  }
  const cum = cumulative(coords);
  const starts: number[] = [];
  let k = 0;
  for (const s of edgeStartsM) {
    while (k < cum.length - 1 && Math.abs(cum[k + 1] - s) <= Math.abs(cum[k] - s)) k++;
    starts.push(k);
  }
  for (let i = 0; i < edgeIds.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : coords.length - 1;
    if (to <= from) continue;
    const pts = coords.slice(from, to + 1);
    const len = cumulative(pts)[pts.length - 1];
    course.append({
      edgeId: edgeIds[i],
      direction: directions[i],
      edgeOffsetStartM: directions[i] === 1 ? 0 : len,
      endNode: null,
      pts,
    });
  }
  return course;
}

function segmentIndex(cum: number[], local: number): number {
  let lo = 0;
  let hi = cum.length - 2;
  if (hi <= 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= local) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
