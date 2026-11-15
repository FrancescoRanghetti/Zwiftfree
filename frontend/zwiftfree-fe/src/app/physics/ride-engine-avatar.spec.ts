import { AvatarEvent, AvatarMachine } from '../avatar/avatar-machine';
import { Course } from './course';
import { riderParams } from './physics';
import { RideEngine, RideSample } from './ride-engine';
import { RoadGraph } from './road-graph';
import { line } from './testing';

const RIDER = riderParams(75, 8, 0.32, 0.004);

/** 1 km at −10 %, then a right-angle bend and 300 m flat. */
function descentWithBend(): Course {
  const c = new Course();
  c.append({
    edgeId: 1,
    direction: 1,
    edgeOffsetStartM: 0,
    endNode: null,
    pts: line([9, 46, 300], [9, 46.009, 200], 100),
  });
  c.append({
    edgeId: 2,
    direction: 1,
    edgeOffsetStartM: 0,
    endNode: null,
    pts: line([9, 46.009, 200], [9.0039, 46.009, 200], 30),
  });
  return c;
}

/** 300 m climbing at 10 %. */
function climb(): Course {
  const c = new Course();
  c.append({
    edgeId: 1,
    direction: 1,
    edgeOffsetStartM: 0,
    endNode: null,
    pts: line([9, 46, 200], [9, 46.0027, 230], 30),
  });
  return c;
}

function setup(course: Course, machine: AvatarMachine) {
  const events: AvatarEvent[] = [];
  const samples: RideSample[] = [];
  const engine = new RideEngine(
    course,
    new RoadGraph(),
    'route',
    RIDER,
    { avatarEvent: (e) => events.push(e), sample: (s) => samples.push(s) },
    machine,
  );
  const ride = (seconds: number, power: number, cadence = power ? 90 : 0) => {
    for (let i = 0; i < Math.round(seconds * 10); i++)
      engine.tick(0.1, { power, cadence, hr: null });
  };
  return { engine, events, samples, ride };
}

describe('RideEngine with the avatar', () => {
  it('measures bends', () => {
    const c = descentWithBend();
    expect(c.turnRadiusAt(500)).toBeGreaterThan(1000);
    expect(c.turnRadiusAt(c.legs[1].startM)).toBeLessThan(10);
  });

  it('stops for a pee break: the bike stays put, the clock keeps running', () => {
    const m = new AvatarMachine({
      peeBreakEnabled: true,
      peeBreakAfterS: 5,
      crashesEnabled: false,
    });
    const { engine, events, samples, ride } = setup(climb(), m);
    ride(3, 200);
    ride(10, 0); // rolls to a stop on the 10 % climb, then 5 s still
    expect(engine.state).toBe('PEE_BREAK');
    expect(events.map((e) => e.type)).toEqual(['PEE_BREAK_START']);
    const d = engine.distance;
    const clock = engine.clock;
    ride(5, 0);
    expect(engine.distance).toBe(d);
    expect(engine.clock).toBeCloseTo(clock + 5, 5);
    expect(samples[samples.length - 1].avatarState).toBe('PEE_BREAK');
    ride(1, 200);
    expect(events.map((e) => e.type)).toEqual(['PEE_BREAK_START', 'PEE_BREAK_END']);
    expect(engine.distance).toBe(d); // still getting back on the bike
    ride(2, 200);
    expect(engine.distance).toBeGreaterThan(d);
  });

  it('crashes when braking hard on a fast descent, stays down, then rides on', () => {
    // 0.25: no random fall (≥ 1/2000), braking crash (< 0.3), penalty 5 + 0.25·5 = 6.25 s
    const m = new AvatarMachine(
      { peeBreakEnabled: false, peeBreakAfterS: 20, crashesEnabled: true },
      () => 0.25,
    );
    const { engine, events, ride } = setup(descentWithBend(), m);
    ride(15, 250);
    expect(engine.speed * 3.6).toBeGreaterThan(35);
    ride(0.1, 0, 0);
    expect(events[0]).toMatchObject({ type: 'CRASH', payload: { reason: 'HARD_BRAKING' } });
    expect(engine.state).toBe('CRASHED');
    expect(engine.speed).toBe(0);
    const d = engine.distance;
    ride(3, 0, 0);
    expect(engine.state).toBe('RECOVERING');
    expect(engine.distance).toBe(d);
    ride(2, 200);
    expect(engine.state).toBe('RECOVERING'); // penalty not over
    ride(2, 200);
    expect(engine.state).toBe('RIDING');
    expect(events.map((e) => e.type)).toEqual(['CRASH', 'RECOVERED']);
    ride(1, 200);
    expect(engine.distance).toBeGreaterThan(d);
  });

  it('corner assist brakes before a tight bend; without it the bend is taken flat out', () => {
    const speedAtBend = (assist: boolean) => {
      const m = new AvatarMachine({
        peeBreakEnabled: false,
        peeBreakAfterS: 20,
        crashesEnabled: false,
      });
      const { engine, ride } = setup(descentWithBend(), m);
      engine.cornerAssist = assist;
      const bend = engine.course.legs[1].startM;
      while (engine.distance < bend - 1) ride(0.1, 100);
      return engine.speed * 3.6;
    };
    expect(speedAtBend(false)).toBeGreaterThan(45);
    expect(speedAtBend(true)).toBeLessThan(25);
  });

  it('crashes in the bend without assist when crashes are on (and the roll says so)', () => {
    const m = new AvatarMachine(
      { peeBreakEnabled: false, peeBreakAfterS: 20, crashesEnabled: true },
      () => 0.4,
    );
    const { engine, events, ride } = setup(descentWithBend(), m);
    while (!events.length && engine.distance < 1100) ride(0.1, 100);
    expect(events[0]).toMatchObject({ type: 'CRASH', payload: { reason: 'CORNER' } });
  });
});
