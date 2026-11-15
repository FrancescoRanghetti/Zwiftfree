import { Coord3, RoadEdge } from '../core/api/roads.models';

/** Tiny synthetic road network for tests: points every ~10 m along straight lines near 46°N 9°E. */
export const NODES: Record<number, [number, number, number]> = {
  1: [9.0, 46.0, 200], // south
  2: [9.0, 46.0009, 205], // junction, ~100 m north of 1
  3: [9.0, 46.0018, 215], // straight on (north)
  4: [9.0013, 46.0009, 205], // right (east)
  5: [8.9987, 46.0009, 205], // left (west)
  6: [9.0, 46.0027, 220], // dead end north of 3
};

export function line(
  a: [number, number, number],
  b: [number, number, number],
  steps = 10,
): Coord3[] {
  const out: Coord3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

export function edge(
  id: number,
  source: number,
  target: number,
  opts: Partial<RoadEdge> = {},
): RoadEdge {
  return {
    id,
    source,
    target,
    name: null,
    highway: 'residential',
    surface: null,
    oneway: 0,
    rank: 6,
    lengthM: 100,
    ascentM: 0,
    descentM: 0,
    avgGrade: 0,
    maxGrade: 0,
    minGrade: 0,
    forwardAllowed: true,
    backwardAllowed: true,
    coordinates: line(NODES[source], NODES[target]),
    ...opts,
  };
}

/** 1→2 south-north, then at 2: 2→3 straight, 2→4 right, 2→5 left; 3→6 dead end. */
export function crossroads(overrides: Record<number, Partial<RoadEdge>> = {}): RoadEdge[] {
  return [
    edge(12, 1, 2, overrides[12]),
    edge(23, 2, 3, overrides[23]),
    edge(24, 2, 4, overrides[24]),
    edge(25, 2, 5, overrides[25]),
    edge(36, 3, 6, overrides[36]),
  ];
}
