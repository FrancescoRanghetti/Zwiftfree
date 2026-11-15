import { AvatarEvent, AvatarMachine, AvatarState } from '../avatar/avatar-machine';
import { RoadEdge } from '../core/api/roads.models';
import { Course, NewLeg } from './course';
import { cumulative } from './geo';
import { TurnChoice, turnChoices } from './junctions';
import { RiderParams, stepSpeed } from './physics';
import { RoadGraph, canTravel, edgeCoords, endNode } from './road-graph';

export type RideKind = 'route' | 'free';
/** The avatar's state, plus FINISHED at the end of a planned route. */
export type RiderState = AvatarState | 'FINISHED';

export interface RideInputs {
  power: number;
  cadence: number;
  hr: number | null;
}

/** One second of riding, as stored by the backend. */
export interface RideSample {
  t: number;
  distanceM: number;
  lat: number;
  lon: number;
  ele: number;
  grade: number;
  power: number;
  cadence: number;
  hr: number | null;
  speedKmh: number;
  avatarState: string;
  edgeId: number | null;
  edgeOffsetM: number | null;
}

export interface RideEdgeEntry {
  seq: number;
  edgeId: number;
  direction: 1 | -1;
  /** ride distance when the edge was entered (the backend times segments with it) */
  startM: number;
}

export interface EngineHooks {
  sample?(s: RideSample): void;
  edgeEntered?(e: RideEdgeEntry): void;
  finished?(): void;
  /** The road graph should be extended around this point (GET /api/roads/area). */
  needArea?(p: { lat: number; lon: number }): void;
  choicesChanged?(choices: TurnChoice[], selected: number): void;
  /** Pee break started/ended, crash, back on the bike. */
  avatarEvent?(e: AvatarEvent): void;
  /** The way back of an out-and-back is not rideable (one-way): the ride continued as a free ride. */
  turnaroundFallback?(): void;
}

/** Turn arrows appear this far before a junction (spec §5.4). */
export const CHOICE_LOOKAHEAD_M = 150;
/** Load more roads when the rider is closer than this to the edge of what is loaded. */
export const AREA_MARGIN_M = 1000;
export const AREA_RADIUS_M = 2000;
export const ASSIST_LOOKAHEAD_M = 40;
export const ASSIST_MAX_RADIUS_M = 40;
export const ASSIST_LATERAL_ACC = 4.5;
export const ASSIST_BRAKE = 6;

/**
 * The ride simulation: advances the virtual bike along the course with the physics model, chooses the next road
 * at junctions in free ride, and produces one sample per second. Framework-free and driven by `tick(dt)`, so it
 * can be unit-tested with synthetic time.
 */
export class RideEngine {
  kind: RideKind;
  private finished = false;
  /** Corner assist (settings): brake automatically before tight bends instead of risking a crash. */
  cornerAssist = false;
  /** m/s */
  speed = 0;
  distance = 0;
  prevDistance = 0;
  /** Ride clock in seconds; starts at the first pedal stroke and stops while paused. */
  clock = 0;
  ascent = 0;
  grade = 0;
  choices: TurnChoice[] = [];
  selected = -1;
  /** Power of the last 30 ticks (3 s at 10 Hz). */
  private readonly recentPower: number[] = [];
  /** Average power of every second so far (for NP). */
  readonly powerBySecond: number[] = [];

  private choicesForLeg = -1;
  private enteredLeg = -1;
  private seq = 0;
  private second = { power: 0, cadence: 0, n: 0 };
  private lastSampleEle: number | null = null;
  private lastAreaRequest = -Infinity;
  /** Seconds since the engine was created, paused time excluded. */
  private age = 0;

  constructor(
    readonly course: Course,
    readonly graph: RoadGraph,
    kind: RideKind,
    private rider: RiderParams,
    private readonly hooks: EngineHooks = {},
    /** Pee breaks and crashes are off unless the caller passes a configured machine. */
    readonly avatar: AvatarMachine = new AvatarMachine({
      peeBreakEnabled: false,
      peeBreakAfterS: 20,
      crashesEnabled: false,
    }),
  ) {
    this.kind = kind;
    this.grade = course.legs.length ? course.gradeAt(0) : 0;
  }

  setRider(rider: RiderParams): void {
    this.rider = rider;
  }

  get remainingM(): number | null {
    return this.kind === 'route' ? Math.max(0, this.course.lengthM - this.distance) : null;
  }

  get power3s(): number {
    const p = this.recentPower;
    return p.length ? p.reduce((a, b) => a + b, 0) / p.length : 0;
  }

  /** Live normalized power (30 s rolling average, 4th power mean); null for the first 30 s. */
  get normalizedPower(): number | null {
    const p = this.powerBySecond;
    if (p.length < 30) return null;
    let window = 0;
    let sum4 = 0;
    let n = 0;
    for (let i = 0; i < p.length; i++) {
      window += p[i];
      if (i >= 30) window -= p[i - 30];
      if (i >= 29) {
        sum4 += (window / 30) ** 4;
        n++;
      }
    }
    return Math.round((sum4 / n) ** 0.25);
  }

  get state(): RiderState {
    return this.finished ? 'FINISHED' : this.avatar.state;
  }

  pause(): void {
    if (!this.finished) this.avatar.pause();
  }

  resume(): void {
    this.avatar.resume();
  }

  /** Smoothly interpolated distance between two physics ticks (alpha 0..1). */
  renderDistance(alpha: number): number {
    const a = Math.min(1, Math.max(0, alpha));
    return this.prevDistance + (this.distance - this.prevDistance) * a;
  }

  tick(dt: number, input: RideInputs): void {
    this.prevDistance = this.distance;
    if (this.finished || this.avatar.state === 'PAUSED' || !this.course.legs.length) return;
    this.age += dt;

    const here = this.course.pointAt(this.distance);
    this.grade = this.course.gradeAt(this.distance);
    const events = this.avatar.step({
      dt,
      power: input.power,
      cadence: input.cadence,
      speedKmh: this.speed * 3.6,
      gradePercent: this.grade,
      turnRadiusM: this.course.turnRadiusAt(this.distance),
    });
    for (const e of events) this.hooks.avatarEvent?.(e);
    if (this.avatar.frozen) {
      // On the ground, behind the bush or getting back on: the bike does not move.
      this.speed = 0;
    } else {
      this.speed = stepSpeed(this.speed, input.power, this.grade, here.ele, dt, this.rider);
      if (this.cornerAssist) this.speed = this.assistedSpeed(this.speed, dt);
    }
    let next = this.distance + this.speed * dt;
    const end = this.course.lengthM;
    if (next >= end) {
      next = end;
      if (this.kind === 'free') this.speed = Math.min(this.speed, 1); // waiting for the next road to load
    }
    this.distance = next;
    this.navigate();
    this.trackLegs();

    this.recentPower.push(input.power);
    if (this.recentPower.length > 30) this.recentPower.shift();
    if (this.state !== 'IDLE') {
      const before = Math.floor(this.clock);
      // Rounded so that ten 0.1 s ticks make exactly one second.
      this.clock = Math.round((this.clock + dt) * 1e6) / 1e6;
      this.second.power += input.power;
      this.second.cadence += input.cadence;
      this.second.n++;
      for (let t = before; t < Math.floor(this.clock); t++) this.emitSample(t, input);
    }
    if (this.kind === 'route' && this.distance >= end - 0.01) {
      this.finished = true;
      this.speed = 0;
      this.hooks.finished?.();
    }
  }

  /**
   * Corner assist: the tightest bend in the next 40 m sets a safe speed √(a·r) (a = 4.5 m/s², 38 km/h at 25 m);
   * above it the bike brakes at up to 6 m/s².
   */
  private assistedSpeed(v: number, dt: number): number {
    let minR = Infinity;
    for (let k = 0; k <= ASSIST_LOOKAHEAD_M; k += 10) {
      minR = Math.min(minR, this.course.turnRadiusAt(this.distance + k));
    }
    if (minR >= ASSIST_MAX_RADIUS_M) return v;
    const safe = Math.sqrt(ASSIST_LATERAL_ACC * minR);
    return v > safe ? Math.max(safe, v - ASSIST_BRAKE * dt) : v;
  }

  /** Picks one of the current turn choices (before reaching the junction). */
  choose(index: number): void {
    if (index < 0 || index >= this.choices.length || index === this.selected) return;
    const legs = this.course.legs;
    // Only while the tentative leg after the junction has not been entered yet.
    if (this.choicesForLeg !== legs.length - 2 || this.enteredLeg > this.choicesForLeg) return;
    this.course.truncate(this.choicesForLeg + 1);
    this.course.append(legFromChoice(this.choices[index]));
    this.selected = index;
    this.hooks.choicesChanged?.(this.choices, this.selected);
  }

  canTurnAround(): boolean {
    if (this.state === 'FINISHED' || !this.course.legs.length) return false;
    const leg = this.course.legs[this.course.legIndexAt(this.distance)];
    const edge = leg.edgeId === null ? undefined : this.graph.edge(leg.edgeId);
    return !!edge && canTravel(edge, -leg.direction as 1 | -1);
  }

  /**
   * U-turn on the current road. Free ride: continue freely. Planned route: ride back to the start on the same
   * roads (out-and-back); if a one-way makes that impossible, continue as a free ride.
   */
  turnAround(): boolean {
    if (!this.canTurnAround()) return false;
    const i = this.course.legIndexAt(this.distance);
    const leg = this.course.legs[i];
    const edge = this.graph.edge(leg.edgeId!)!;
    const offset = this.course.pointAt(this.distance).edgeOffsetM;
    const ridden = this.course.legs.slice(0, i);
    this.course.cutAt(this.distance);
    const back = -leg.direction as 1 | -1;
    this.course.append(partialEdgeLeg(edge, back, offset));
    this.clearChoices();
    if (this.kind === 'route') {
      const legal = ridden.every((l) => {
        const e = l.edgeId === null ? undefined : this.graph.edge(l.edgeId);
        return !!e && canTravel(e, -l.direction as 1 | -1);
      });
      if (legal) {
        for (const l of [...ridden].reverse()) {
          this.course.append({
            edgeId: l.edgeId,
            direction: -l.direction as 1 | -1,
            edgeOffsetStartM: Math.max(0, l.edgeOffsetStartM + l.direction * l.lengthM),
            endNode: null,
            pts: [...l.pts].reverse(),
          });
        }
      } else {
        this.kind = 'free';
        this.hooks.turnaroundFallback?.();
      }
    }
    return true;
  }

  private clearChoices(): void {
    if (this.choices.length || this.choicesForLeg !== -1) {
      this.choices = [];
      this.selected = -1;
      this.choicesForLeg = -1;
      this.hooks.choicesChanged?.([], -1);
    }
  }

  private navigate(): void {
    const p = this.course.pointAt(this.distance);
    if (!this.graph.covers(p, AREA_MARGIN_M)) this.requestArea(p);
    if (this.kind !== 'free') return;
    const legs = this.course.legs;
    const i = this.course.legIndexAt(this.distance);
    if (i !== legs.length - 1 || this.choicesForLeg === i) return;
    const leg = legs[i];
    const remaining = leg.startM + leg.lengthM - this.distance;
    if (remaining > CHOICE_LOOKAHEAD_M || leg.endNode === null) return;
    const nodePos = this.graph.nodePosition(leg.endNode);
    if (!nodePos || !this.graph.covers({ lon: nodePos[0], lat: nodePos[1] }, 100)) {
      const target = nodePos ? { lon: nodePos[0], lat: nodePos[1] } : p;
      this.requestArea(target);
      return;
    }
    const inEdge = leg.edgeId === null ? undefined : this.graph.edge(leg.edgeId);
    let choices = turnChoices(
      leg.endNode,
      leg.pts,
      inEdge,
      leg.direction,
      this.graph.at(leg.endNode),
    );
    if (!choices.length && inEdge) {
      // One-way dead end (data glitch): turning around is the only way on.
      choices = [
        {
          edge: inEdge,
          direction: -leg.direction as 1 | -1,
          turn: 180,
          maneuver: 'U_TURN',
          preferred: true,
        },
      ];
    }
    if (!choices.length) return;
    this.choices = choices;
    this.selected = choices.findIndex((c) => c.preferred);
    this.choicesForLeg = i;
    this.course.append(legFromChoice(choices[this.selected]));
    this.hooks.choicesChanged?.(this.choices, this.selected);
  }

  private requestArea(p: { lat: number; lon: number }): void {
    // At most one request every 5 s; areaSettled() lifts the wait.
    if (this.age - this.lastAreaRequest < 5) return;
    this.lastAreaRequest = this.age;
    this.hooks.needArea?.({ lat: p.lat, lon: p.lon });
  }

  /** Lets an area request go out immediately (after a load finished or failed). */
  areaSettled(): void {
    this.lastAreaRequest = -Infinity;
  }

  private trackLegs(): void {
    const idx = this.course.legIndexAt(this.distance);
    while (this.enteredLeg < idx) {
      this.enteredLeg++;
      const leg = this.course.legs[this.enteredLeg];
      if (leg.edgeId !== null) {
        this.hooks.edgeEntered?.({
          seq: this.seq++,
          edgeId: leg.edgeId,
          direction: leg.direction,
          startM: round1(leg.startM),
        });
      }
      if (this.choicesForLeg !== -1 && this.enteredLeg > this.choicesForLeg) this.clearChoices();
    }
  }

  private emitSample(t: number, input: RideInputs): void {
    const n = Math.max(1, this.second.n);
    const power = Math.round(this.second.power / n);
    const cadence = Math.round(this.second.cadence / n);
    this.second = { power: 0, cadence: 0, n: 0 };
    this.powerBySecond.push(power);
    const p = this.course.pointAt(this.distance);
    if (this.lastSampleEle !== null && p.ele > this.lastSampleEle)
      this.ascent += p.ele - this.lastSampleEle;
    this.lastSampleEle = p.ele;
    this.hooks.sample?.({
      t,
      distanceM: round1(this.distance),
      lat: round6(p.lat),
      lon: round6(p.lon),
      ele: round1(p.ele),
      grade: round1(this.grade),
      power,
      cadence,
      hr: input.hr,
      speedKmh: round1(this.speed * 3.6),
      avatarState: this.state,
      edgeId: p.edgeId,
      edgeOffsetM: p.edgeId === null ? null : round1(p.edgeOffsetM),
    });
  }
}

function legFromChoice(c: TurnChoice): NewLeg {
  const pts = edgeCoords(c.edge, c.direction);
  const len = cumulative(pts)[pts.length - 1];
  return {
    edgeId: c.edge.id,
    direction: c.direction,
    edgeOffsetStartM: c.direction === 1 ? 0 : len,
    endNode: endNode(c.edge, c.direction),
    pts,
  };
}

/** The part of an edge from `offsetM` (measured from its source) to its end in the travel direction. */
export function partialEdgeLeg(edge: RoadEdge, direction: 1 | -1, offsetM: number): NewLeg {
  const coords = edge.coordinates;
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  const o = Math.min(total, Math.max(0, offsetM));
  let j = 0;
  while (j < cum.length - 2 && cum[j + 1] <= o) j++;
  const span = cum[j + 1] - cum[j];
  const t = span > 0 ? (o - cum[j]) / span : 0;
  const a = coords[j];
  const b = coords[j + 1];
  const p: [number, number, number] = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const rest = direction === 1 ? coords.slice(j + 1) : coords.slice(0, j + 1).reverse();
  const pts = [p, ...rest];
  if (pts.length < 2) pts.push(p);
  return {
    edgeId: edge.id,
    direction,
    edgeOffsetStartM: o,
    endNode: endNode(edge, direction),
    pts,
  };
}

/**
 * Free ride start on an edge at `fraction` (0..1 from its source), heading the legal way; when both ways are legal,
 * towards the longer part of the road (a point snapped to the end of a road would otherwise start at a junction).
 */
export function freeRideCourse(edge: RoadEdge, fraction: number): Course {
  const course = new Course();
  const len = cumulative(edge.coordinates)[edge.coordinates.length - 1];
  const dir: 1 | -1 =
    edge.forwardAllowed && edge.backwardAllowed
      ? fraction <= 0.5
        ? 1
        : -1
      : edge.forwardAllowed
        ? 1
        : -1;
  course.append(partialEdgeLeg(edge, dir, fraction * len));
  return course;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
