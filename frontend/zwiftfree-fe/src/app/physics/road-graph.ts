import { Coord3, RoadEdge } from '../core/api/roads.models';
import { distance } from './geo';

/** Edges loaded around the rider (GET /api/roads/area), indexed by id and by junction. */
export class RoadGraph {
  private readonly edges = new Map<number, RoadEdge>();
  private readonly byNode = new Map<number, number[]>();
  private readonly areas: { center: [number, number]; radiusM: number }[] = [];

  get size(): number {
    return this.edges.size;
  }

  add(edges: RoadEdge[], center?: { lat: number; lon: number }, radiusM?: number): void {
    for (const e of edges) {
      if (this.edges.has(e.id)) continue;
      this.edges.set(e.id, e);
      for (const n of [e.source, e.target]) {
        const list = this.byNode.get(n);
        if (list) list.push(e.id);
        else this.byNode.set(n, [e.id]);
      }
    }
    if (center && radiusM) this.areas.push({ center: [center.lon, center.lat], radiusM });
  }

  edge(id: number): RoadEdge | undefined {
    return this.edges.get(id);
  }

  /** Every loaded edge touching a junction. Complete only if the junction lies inside a loaded area. */
  at(node: number): RoadEdge[] {
    return (this.byNode.get(node) ?? []).map((id) => this.edges.get(id)!);
  }

  /** True when a point is at least `marginM` inside an area that was loaded in full. */
  covers(p: { lat: number; lon: number }, marginM: number): boolean {
    return this.areas.some((a) => distance(a.center, [p.lon, p.lat]) <= a.radiusM - marginM);
  }

  nodePosition(node: number): Coord3 | null {
    const e = this.at(node)[0];
    if (!e) return null;
    return e.source === node ? e.coordinates[0] : e.coordinates[e.coordinates.length - 1];
  }
}

export function canTravel(e: RoadEdge, direction: 1 | -1): boolean {
  return direction === 1 ? e.forwardAllowed : e.backwardAllowed;
}

export function startNode(e: RoadEdge, direction: 1 | -1): number {
  return direction === 1 ? e.source : e.target;
}

export function endNode(e: RoadEdge, direction: 1 | -1): number {
  return direction === 1 ? e.target : e.source;
}

/** Points in travel order. */
export function edgeCoords(e: RoadEdge, direction: 1 | -1): Coord3[] {
  return direction === 1 ? e.coordinates : [...e.coordinates].reverse();
}
