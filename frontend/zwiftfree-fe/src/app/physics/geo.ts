/** Spherical-earth helpers (same formulas as the backend's Geo). Points are [lon, lat, ...]. */

const R = 6_371_008.8;
const RAD = Math.PI / 180;

type P = readonly number[];

export function distance(a: P, b: P): number {
  const p1 = a[1] * RAD;
  const p2 = b[1] * RAD;
  const dp = p2 - p1;
  const dl = (b[0] - a[0]) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees [0, 360). */
export function bearing(a: P, b: P): number {
  const p1 = a[1] * RAD;
  const p2 = b[1] * RAD;
  const dl = (b[0] - a[0]) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Signed turn (-180, 180]: negative = left, positive = right. */
export function turn(fromBearing: number, toBearing: number): number {
  const d = ((((toBearing - fromBearing + 540) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Cumulative distance along a polyline, starting at 0. */
export function cumulative(pts: readonly P[]): number[] {
  const out = new Array<number>(pts.length);
  out[0] = 0;
  for (let i = 1; i < pts.length; i++) out[i] = out[i - 1] + distance(pts[i - 1], pts[i]);
  return out;
}

/** Bearing at the end (arrival) or start (departure) of a polyline, measured over ~span metres. */
export function polylineBearing(pts: readonly P[], atEnd: boolean, span: number): number {
  if (pts.length < 2) return 0;
  if (atEnd) {
    const last = pts[pts.length - 1];
    let i = pts.length - 2;
    let acc = 0;
    while (i > 0 && acc < span) {
      acc += distance(pts[i], pts[i + 1]);
      if (acc >= span) break;
      i--;
    }
    return bearing(pts[i], last);
  }
  const first = pts[0];
  let i = 1;
  let acc = 0;
  while (i < pts.length - 1 && acc < span) {
    acc += distance(pts[i - 1], pts[i]);
    if (acc >= span) break;
    i++;
  }
  return bearing(first, pts[i]);
}

/** Radius (m) of the circle through three points; Infinity when they are aligned. */
export function turnRadius(a: P, b: P, c: P): number {
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ca = distance(c, a);
  const s = (ab + bc + ca) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca)));
  return area < 1e-6 ? Infinity : (ab * bc * ca) / (4 * area);
}
