import { Course } from './course';
import { riderParams } from './physics';
import { RideEdgeEntry, RideEngine, RideSample, freeRideCourse } from './ride-engine';
import { RoadGraph } from './road-graph';
import { NODES, crossroads, line } from './testing';

const RIDER = riderParams(75, 8, 0.32, 0.004);
const CENTER = { lat: 46.0009, lon: 9.0 };

function setup(kind: 'free' | 'route' = 'free') {
  const graph = new RoadGraph();
  graph.add(crossroads(), CENTER, 5000);
  const course =
    kind === 'free'
      ? freeRideCourse(graph.edge(12)!, 0)
      : (() => {
          const c = new Course();
          c.append({
            edgeId: 12,
            direction: 1,
            edgeOffsetStartM: 0,
            endNode: 2,
            pts: line(NODES[1], NODES[2]),
          });
          c.append({
            edgeId: 23,
            direction: 1,
            edgeOffsetStartM: 0,
            endNode: 3,
            pts: line(NODES[2], NODES[3]),
          });
          return c;
        })();
  const samples: RideSample[] = [];
  const edges: RideEdgeEntry[] = [];
  const events: string[] = [];
  const engine = new RideEngine(course, graph, kind, RIDER, {
    sample: (s) => samples.push(s),
    edgeEntered: (e) => edges.push(e),
    finished: () => events.push('finished'),
    needArea: () => events.push('area'),
    turnaroundFallback: () => events.push('fallback'),
  });
  const ride = (seconds: number, power = 250) => {
    for (let i = 0; i < seconds * 10; i++)
      engine.tick(0.1, { power, cadence: power ? 90 : 0, hr: 140 });
  };
  return { engine, samples, edges, events, ride };
}

describe('RideEngine', () => {
  it('stays idle and keeps the clock at zero until the first pedal stroke', () => {
    const { engine, samples, ride } = setup();
    ride(3, 0);
    expect(engine.state).toBe('IDLE');
    expect(engine.clock).toBe(0);
    expect(samples).toHaveLength(0);
  });

  it('records one sample per second with averaged power', () => {
    const { engine, samples, ride } = setup();
    ride(5);
    expect(engine.state).toBe('RIDING');
    expect(samples.map((s) => s.t)).toEqual([0, 1, 2, 3, 4]);
    expect(samples[4].power).toBe(250);
    expect(samples[4].edgeId).toBe(12);
    expect(samples[4].hr).toBe(140);
    expect(samples[4].speedKmh).toBeGreaterThan(samples[0].speedKmh);
    expect(engine.power3s).toBe(250);
  });

  it('offers choices before the junction, takes the chosen road and records ridden edges', () => {
    const { engine, edges, ride } = setup();
    let guard = 0;
    while (!engine.choices.length && guard++ < 600) ride(0.1);
    expect(engine.choices.map((c) => c.maneuver)).toEqual(['LEFT', 'STRAIGHT', 'RIGHT']);
    expect(engine.choices[engine.selected].maneuver).toBe('STRAIGHT');
    const toJunction = engine.course.legs[0].lengthM - engine.distance;
    expect(toJunction).toBeLessThanOrEqual(150);
    engine.choose(2);
    ride(40);
    expect(edges.map((e) => e.edgeId)).toEqual([12, 24, 24]); // right, then dead end U-turn back
  });

  it('follows the preferred road without input and turns around at a dead end', () => {
    const { engine, edges, ride } = setup();
    ride(150); // 5–10% climbs: about 3–4 m/s
    expect(edges.slice(0, 3).map((e) => e.edgeId)).toEqual([12, 23, 36]);
    expect(edges[3]).toMatchObject({ seq: 3, edgeId: 36, direction: -1 });
    expect(edges[3].startM).toBeGreaterThan(edges[2].startM);
    expect(engine.distance).toBeGreaterThan(300);
  });

  it('pauses the clock', () => {
    const { engine, ride } = setup();
    ride(2);
    engine.pause();
    const clock = engine.clock;
    const d = engine.distance;
    ride(5);
    expect(engine.clock).toBe(clock);
    expect(engine.distance).toBe(d);
    engine.resume();
    ride(1);
    expect(engine.clock).toBeGreaterThan(clock);
  });

  it('finishes a planned route at its end', () => {
    const { engine, events, ride, edges } = setup('route');
    expect(engine.remainingM).toBeCloseTo(200.1, 0);
    ride(120);
    expect(engine.state).toBe('FINISHED');
    expect(events).toContain('finished');
    expect(edges.map((e) => e.edgeId)).toEqual([12, 23]);
    expect(engine.ascent).toBeGreaterThan(10);
  });

  it('turns around on a planned route and rides back to the start', () => {
    const { engine, events, ride, edges } = setup('route');
    while (engine.distance < 150) ride(0.1);
    expect(engine.canTurnAround()).toBe(true);
    engine.turnAround();
    expect(engine.course.lengthM).toBeCloseTo(300, -1);
    ride(120);
    expect(events).toContain('finished');
    expect(edges.map((e) => [e.edgeId, e.direction])).toEqual([
      [12, 1],
      [23, 1],
      [23, -1],
      [12, -1],
    ]);
    const last = engine.course.pointAt(engine.distance);
    expect(last.lat).toBeCloseTo(46.0, 6);
  });

  it('falls back to free ride when the way back is a one-way', () => {
    const graph = new RoadGraph();
    graph.add(crossroads({ 12: { backwardAllowed: false } }), CENTER, 5000);
    const c = new Course();
    c.append({
      edgeId: 12,
      direction: 1,
      edgeOffsetStartM: 0,
      endNode: 2,
      pts: line(NODES[1], NODES[2]),
    });
    c.append({
      edgeId: 23,
      direction: 1,
      edgeOffsetStartM: 0,
      endNode: 3,
      pts: line(NODES[2], NODES[3]),
    });
    const events: string[] = [];
    const engine = new RideEngine(c, graph, 'route', RIDER, {
      turnaroundFallback: () => events.push('fb'),
    });
    while (engine.distance < 150) engine.tick(0.1, { power: 250, cadence: 90, hr: null });
    expect(engine.turnAround()).toBe(true);
    expect(engine.kind).toBe('free');
    expect(events).toEqual(['fb']);
  });

  it('cannot turn around against a one-way', () => {
    const graph = new RoadGraph();
    graph.add(crossroads({ 12: { backwardAllowed: false } }), CENTER, 5000);
    const engine = new RideEngine(freeRideCourse(graph.edge(12)!, 0.2), graph, 'free', RIDER);
    expect(engine.canTurnAround()).toBe(false);
  });

  it('starts a free ride towards the longer part of a two-way road', () => {
    const graph = new RoadGraph();
    graph.add(crossroads(), CENTER, 5000);
    expect(freeRideCourse(graph.edge(12)!, 0.2).legs[0].direction).toBe(1);
    const nearEnd = freeRideCourse(graph.edge(12)!, 1);
    expect(nearEnd.legs[0].direction).toBe(-1);
    expect(nearEnd.lengthM).toBeCloseTo(100, -1);
    const oneWay = new RoadGraph();
    oneWay.add(crossroads({ 12: { backwardAllowed: false } }), CENTER, 5000);
    const atEnd = freeRideCourse(oneWay.edge(12)!, 1);
    expect(atEnd.legs[0].direction).toBe(1);
    expect(atEnd.lengthM).toBeLessThan(1);
    // Starting right at the junction: the choices come at once and the ride goes on.
    const engine = new RideEngine(atEnd, oneWay, 'free', RIDER);
    for (let i = 0; i < 100; i++) engine.tick(0.1, { power: 250, cadence: 90, hr: null });
    expect(engine.distance).toBeGreaterThan(20);
    expect(engine.course.legs.length).toBeGreaterThanOrEqual(2);
  });

  it('asks for more roads when leaving the loaded area', () => {
    const graph = new RoadGraph();
    graph.add(crossroads(), { lat: 45.9, lon: 9.0 }, 2000);
    const events: string[] = [];
    const engine = new RideEngine(freeRideCourse(graph.edge(12)!, 0), graph, 'free', RIDER, {
      needArea: () => events.push('area'),
    });
    engine.tick(0.1, { power: 200, cadence: 90, hr: null });
    expect(events).toEqual(['area']);
  });

  it('computes live normalized power after 30 s', () => {
    const { engine, ride } = setup();
    ride(29);
    expect(engine.normalizedPower).toBeNull();
    ride(2);
    expect(engine.normalizedPower).toBe(250);
  });
});
