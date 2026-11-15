import { Coord3, RoadEdge } from '../core/api/roads.models';
import { polylineBearing, turn } from './geo';
import { canTravel, edgeCoords, startNode } from './road-graph';

export type Maneuver = 'LEFT' | 'STRAIGHT' | 'RIGHT' | 'U_TURN';

export interface TurnChoice {
  edge: RoadEdge;
  direction: 1 | -1;
  /** signed degrees: negative left, positive right */
  turn: number;
  maneuver: Maneuver;
  preferred: boolean;
}

/** Same rules as the backend's JunctionService. */
export const BEARING_SPAN_M = 25;
export const STRAIGHT_DEG = 35;

export function maneuver(t: number): Maneuver {
  if (Math.abs(t) <= STRAIGHT_DEG) return 'STRAIGHT';
  if (Math.abs(t) >= 160) return 'U_TURN';
  return t < 0 ? 'LEFT' : 'RIGHT';
}

/**
 * Ways out of `node` for a rider arriving along `arrival` (points in travel order) on edge `inEdge` / `inDir`.
 * Sorted left to right. Never against a one-way; a dead end gives a U-turn (if the road allows it).
 * The preferred option is the straightest, staying on the most important road and on the same road name.
 */
export function turnChoices(
  node: number,
  arrival: Coord3[],
  inEdge: RoadEdge | undefined,
  inDir: 1 | -1,
  atNode: RoadEdge[],
): TurnChoice[] {
  const inBearing = polylineBearing(arrival, true, BEARING_SPAN_M);
  const cands: Omit<TurnChoice, 'preferred' | 'maneuver'>[] = [];
  for (const out of atNode) {
    for (const dir of [1, -1] as const) {
      if (startNode(out, dir) !== node || !canTravel(out, dir)) continue;
      if (inEdge && out.id === inEdge.id && dir === -inDir) continue;
      const outBearing = polylineBearing(edgeCoords(out, dir), false, BEARING_SPAN_M);
      cands.push({ edge: out, direction: dir, turn: turn(inBearing, outBearing) });
    }
  }
  if (!cands.length) {
    if (inEdge && canTravel(inEdge, -inDir as 1 | -1)) {
      return [
        {
          edge: inEdge,
          direction: -inDir as 1 | -1,
          turn: 180,
          maneuver: 'U_TURN',
          preferred: true,
        },
      ];
    }
    return [];
  }
  const bestRank = Math.min(...cands.map((c) => c.edge.rank));
  const score = (c: (typeof cands)[number]) => {
    let s = Math.abs(c.turn) + 30 * (c.edge.rank - bestRank);
    if (inEdge?.name && inEdge.name === c.edge.name) s -= 25;
    return s;
  };
  const preferred = cands.reduce((best, c) => (score(c) < score(best) ? c : best));
  return cands
    .sort((a, b) => a.turn - b.turn)
    .map((c) => ({ ...c, maneuver: maneuver(c.turn), preferred: c === preferred }));
}

/** Arrow keys: ← leftmost, → rightmost, ↑ the straightest. Returns an index into `choices` or -1. */
export function choiceForKey(choices: TurnChoice[], key: 'left' | 'up' | 'right'): number {
  if (!choices.length) return -1;
  if (key === 'left') return choices[0].turn < -STRAIGHT_DEG ? 0 : -1;
  if (key === 'right') {
    const i = choices.length - 1;
    return choices[i].turn > STRAIGHT_DEG ? i : -1;
  }
  let best = 0;
  for (let i = 1; i < choices.length; i++)
    if (Math.abs(choices[i].turn) < Math.abs(choices[best].turn)) best = i;
  return best;
}
