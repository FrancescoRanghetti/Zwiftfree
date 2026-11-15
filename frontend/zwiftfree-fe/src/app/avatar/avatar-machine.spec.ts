import { seededRandom } from '../shared/random';
import { AvatarInput, AvatarMachine, AvatarSettings, CRASH_RULES } from './avatar-machine';

const ON: AvatarSettings = { peeBreakEnabled: true, peeBreakAfterS: 20, crashesEnabled: true };
const base: AvatarInput = {
  dt: 0.1,
  power: 0,
  cadence: 0,
  speedKmh: 0,
  gradePercent: 0,
  turnRadiusM: Infinity,
};

/** Random source returning the given values in order, then 0.99 (never below a probability). */
function sequence(...values: number[]) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0.99);
}

function run(m: AvatarMachine, seconds: number, input: Partial<AvatarInput>) {
  const events = [];
  for (let k = 0; k < Math.round(seconds * 10); k++) events.push(...m.step({ ...base, ...input }));
  return events;
}

describe('AvatarMachine', () => {
  it('goes IDLE → RIDING → COASTING → RIDING', () => {
    const m = new AvatarMachine(ON, sequence());
    run(m, 1, {});
    expect(m.state).toBe('IDLE');
    run(m, 1, { power: 200, cadence: 90, speedKmh: 30 });
    expect(m.state).toBe('RIDING');
    run(m, 1, { speedKmh: 28 });
    expect(m.state).toBe('COASTING');
    run(m, 0.1, { cadence: 60, speedKmh: 27 });
    expect(m.state).toBe('RIDING');
  });

  it('takes a pee break after 20 s standing still, and gets back on when pedalling', () => {
    const m = new AvatarMachine(ON, sequence());
    run(m, 1, { power: 200, speedKmh: 20 });
    run(m, 5, { speedKmh: 10 }); // still rolling: does not count
    expect(m.state).toBe('COASTING');
    expect(run(m, 19.5, {})).toEqual([]);
    const start = run(m, 1, {});
    expect(m.state).toBe('PEE_BREAK');
    expect(start).toEqual([{ type: 'PEE_BREAK_START' }]);
    expect(m.frozen).toBe(true);
    run(m, 12, {});
    const end = run(m, 0.1, { power: 150, cadence: 80 });
    expect(end[0].type).toBe('PEE_BREAK_END');
    expect(end[0].payload?.['durationS']).toBeGreaterThanOrEqual(12);
    expect(end[0].payload?.['durationS']).toBeLessThanOrEqual(13);
    expect(m.state).toBe('RIDING');
    expect(m.frozen).toBe(true); // remounting
    run(m, 1.5, { power: 150 });
    expect(m.frozen).toBe(false);
  });

  it('never takes a pee break when disabled, and uses the configured delay', () => {
    const off = new AvatarMachine({ ...ON, peeBreakEnabled: false }, sequence());
    run(off, 1, { power: 100 });
    run(off, 60, {});
    expect(off.state).toBe('COASTING');
    const quick = new AvatarMachine({ ...ON, peeBreakAfterS: 5 }, sequence());
    run(quick, 1, { power: 100 });
    run(quick, 5.2, {});
    expect(quick.state).toBe('PEE_BREAK');
  });

  it('crashes on hard braking on a steep fast descent (30%), then recovers after the penalty', () => {
    // Warm-up on a slight uphill (no random-fall rolls there), then the braking on the descent.
    // random: braking 0.2 < 0.3 → crash; 0.5 → penalty 7.5 s
    const m = new AvatarMachine(ON, sequence(0.2, 0.5));
    const descent = { speedKmh: 50, gradePercent: -8 };
    run(m, 2, { speedKmh: 50, gradePercent: 2, power: 250, cadence: 95 });
    const ev = run(m, 0.1, { ...descent, power: 0, cadence: 0 });
    expect(ev).toEqual([
      { type: 'CRASH', payload: { reason: 'HARD_BRAKING', speedKmh: 50, grade: -8 } },
    ]);
    expect(m.state).toBe('CRASHED');
    expect(m.penaltyS).toBeCloseTo(7.5, 5);
    run(m, 2.9, {});
    expect(m.state).toBe('CRASHED');
    run(m, 0.2, {});
    expect(m.state).toBe('RECOVERING');
    // Pedalling before the penalty is over does not help.
    run(m, 2, { power: 100, cadence: 80 });
    expect(m.state).toBe('RECOVERING');
    const rec = run(m, 3, { power: 100, cadence: 80 });
    expect(m.state).toBe('RIDING');
    expect(rec).toEqual([{ type: 'RECOVERED', payload: { downS: 8 } }]);
  });

  it('does not crash on braking when the roll fails, when slow, on gentle slopes, or when disabled', () => {
    const cases: [AvatarSettings, number, number, number][] = [
      [ON, 0.5, 50, -8], // roll 0.5 ≥ 0.3
      [ON, 0.1, 30, -8], // too slow
      [ON, 0.1, 50, -4], // not steep enough
      [{ ...ON, crashesEnabled: false }, 0.1, 50, -8],
    ];
    for (const [settings, roll, speedKmh, gradePercent] of cases) {
      const m = new AvatarMachine(settings, sequence(roll));
      run(m, 2, { speedKmh, gradePercent: 2, power: 250, cadence: 95 });
      run(m, 0.1, { speedKmh, gradePercent, power: 0, cadence: 0 });
      expect(m.state).toBe('COASTING');
    }
  });

  it('a slow stop (cadence fading over more than 1 s) is not a hard braking', () => {
    const m = new AvatarMachine(ON, sequence(0.1));
    const d = { speedKmh: 50, gradePercent: -8 };
    run(m, 2, { ...d, power: 250, cadence: 95 });
    run(m, 1.5, { ...d, power: 0, cadence: 30 }); // freewheeling legs, power already 0
    run(m, 0.1, { ...d, power: 0, cadence: 0 });
    expect(m.state).toBe('COASTING');
  });

  it('crashes in a tight bend taken too fast (50%), once per bend', () => {
    const m = new AvatarMachine(ON, sequence(0.7, 0.4, 0.5));
    run(m, 1, { power: 200, speedKmh: 50, gradePercent: 2 });
    run(m, 1, { power: 200, speedKmh: 50, gradePercent: 2, turnRadiusM: 18 }); // roll 0.7: survived
    expect(m.state).toBe('RIDING');
    run(m, 1, { power: 200, speedKmh: 50, gradePercent: 2 }); // out of the bend
    const ev = run(m, 0.1, { power: 200, speedKmh: 50, gradePercent: 2, turnRadiusM: 18 });
    expect(ev[0]?.payload?.['reason']).toBe('CORNER');
  });

  it('takes tight bends safely below 45 km/h', () => {
    const m = new AvatarMachine(ON, sequence(0));
    run(m, 1, { power: 200, speedKmh: 40, gradePercent: 2, turnRadiusM: 10 });
    expect(m.state).toBe('RIDING');
  });

  it('falls randomly about once every 2000 s, never uphill', () => {
    let crashes = 0;
    const m = new AvatarMachine(ON, seededRandom(42));
    for (let s = 0; s < 200_000; s++) {
      const ev = m.step({ ...base, dt: 1, power: 200, cadence: 90, speedKmh: 30 });
      if (ev.some((e) => e.type === 'CRASH')) {
        crashes++;
        while (m.state !== 'RIDING') m.step({ ...base, dt: 1, power: 200, cadence: 90 });
      }
    }
    expect(crashes).toBeGreaterThan(60);
    expect(crashes).toBeLessThan(140);
    const uphill = new AvatarMachine(ON, () => 0);
    run(uphill, 100, { power: 250, cadence: 80, speedKmh: 15, gradePercent: 6 });
    expect(uphill.state).toBe('RIDING');
    expect(CRASH_RULES.random.perSecond).toBe(1 / 2000);
  });

  it('pauses from any state and comes back to it', () => {
    const m = new AvatarMachine(ON, sequence());
    run(m, 1, { power: 100 });
    run(m, 21, {});
    expect(m.state).toBe('PEE_BREAK');
    m.pause();
    expect(m.state).toBe('PAUSED');
    expect(run(m, 5, { power: 200 })).toEqual([]);
    m.resume();
    expect(m.state).toBe('PEE_BREAK');
  });
});
