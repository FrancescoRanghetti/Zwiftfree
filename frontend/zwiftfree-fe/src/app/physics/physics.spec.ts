import { MAX_SPEED_MS, airDensity, riderParams, stepSpeed, steadySpeed } from './physics';

const RIDER = riderParams(75, 8, 0.32, 0.004);
const kmh = (ms: number) => ms * 3.6;

describe('physics', () => {
  it('200 W on the flat with 75 kg reaches the low-to-mid 30s km/h', () => {
    const v = kmh(steadySpeed(200, 0, 0, RIDER));
    // Spec target "~32–34 km/h"; the spec's own formula and defaults (CdA 0.32, Crr 0.004, ρ 1.2) give 34.5.
    expect(v).toBeGreaterThan(32);
    expect(v).toBeLessThan(35);
    // Power balance at steady state: P = v·(m·g·Crr + ½ρCdA·v²)
    const ms = v / 3.6;
    expect(ms * (83 * 9.80665 * 0.004 + 0.5 * 1.2 * 0.32 * ms * ms)).toBeCloseTo(200, 0);
  });

  it('250 W at 7% climbs at a realistic pace', () => {
    const v = kmh(steadySpeed(250, 7, 0, RIDER));
    // Spec target "~12–13 km/h"; with 83 kg total and the spec formula the balance is ~14.4 km/h.
    expect(v).toBeGreaterThan(12);
    expect(v).toBeLessThan(15);
  });

  it('a heavier rider climbs slower', () => {
    const light = steadySpeed(250, 7, 0, RIDER);
    const heavy = steadySpeed(250, 7, 0, riderParams(95, 8, 0.32, 0.004));
    expect(heavy).toBeLessThan(light);
  });

  it('coasting downhill accelerates but stays below ~75 km/h', () => {
    const v6 = kmh(steadySpeed(0, -6, 500, RIDER));
    expect(v6).toBeGreaterThan(40);
    const v15 = kmh(steadySpeed(0, -15, 500, RIDER));
    expect(v15).toBeLessThanOrEqual(kmh(MAX_SPEED_MS) + 1e-9);
    expect(v15).toBeGreaterThan(65);
  });

  it('never rolls backwards on a climb without power', () => {
    let v = 3;
    for (let i = 0; i < 200; i++) v = stepSpeed(v, 0, 10, 0, 0.1, RIDER);
    expect(v).toBe(0);
  });

  it('stays still on the flat without power', () => {
    expect(stepSpeed(0, 0, 0, 0, 0.1, RIDER)).toBe(0);
  });

  it('starts moving from a standstill (no division by zero)', () => {
    const v = stepSpeed(0, 300, 5, 0, 0.1, RIDER);
    expect(v).toBeGreaterThan(0);
    expect(Number.isFinite(v)).toBe(true);
  });

  it('thinner air at altitude means a little more speed', () => {
    expect(airDensity(2000)).toBeLessThan(airDensity(0));
    expect(steadySpeed(200, 0, 2000, RIDER)).toBeGreaterThan(steadySpeed(200, 0, 0, RIDER));
  });

  it('slows down gradually when the rider stops pedalling', () => {
    let v = 10;
    v = stepSpeed(v, 0, 0, 0, 0.1, RIDER);
    expect(v).toBeLessThan(10);
    expect(v).toBeGreaterThan(9.9);
  });
});
