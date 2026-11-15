import { parsePage, trackResistance, unwrapAnt, wrapAnt } from './fec-protocol';
import {
  parseControlResponse,
  parseIndoorBikeData,
  simulationParams,
  windResistanceCoefficient,
} from './ftms-protocol';
import { parseHeartRate } from './hr-protocol';

const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);

describe('FTMS', () => {
  it('decodes speed, cadence and power (Tacx Neo style flags 0x0044)', () => {
    // flags 0x0044: speed present (bit0 = 0), cadence (bit2), power (bit6)
    const d = parseIndoorBikeData(view(0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00));
    expect(d).toEqual({ speedKmh: 25, cadence: 90, power: 250 });
  });

  it('skips optional fields and reads heart rate', () => {
    // flags: avg speed(1) cadence(2) distance(4) power(6) energy(8) hr(9) = 0x0356
    const d = parseIndoorBikeData(
      view(
        0x56,
        0x03,
        0x10,
        0x27, // speed 100.00
        0x00,
        0x00, // avg speed
        0xa0,
        0x00, // cadence 80
        0x01,
        0x02,
        0x03, // distance
        0x2c,
        0x01, // power 300
        0,
        0,
        0,
        0,
        0, // energy
        0x8c, // hr 140
      ),
    );
    expect(d).toEqual({ speedKmh: 100, cadence: 80, power: 300, hr: 140 });
  });

  it('handles "more data" (no speed) and negative power', () => {
    const d = parseIndoorBikeData(view(0x41, 0x00, 0xfb, 0xff));
    expect(d).toEqual({ power: -5 });
  });

  it('encodes simulation parameters with the spec units', () => {
    const b = simulationParams(5.25, -1.5, 0.004, windResistanceCoefficient(0.32));
    expect(Array.from(b)).toEqual([0x11, 0x24, 0xfa, 0x0d, 0x02, 40, 19]);
    const down = new DataView(simulationParams(-5).buffer);
    expect(down.getInt16(3, true)).toBe(-500);
  });

  it('parses control point responses', () => {
    expect(parseControlResponse(view(0x80, 0x11, 0x01))).toEqual({ request: 0x11, result: 1 });
    expect(parseControlResponse(view(0x11))).toBeNull();
  });
});

describe('FE-C over BLE', () => {
  it('wraps and unwraps ANT messages with checksum', () => {
    const page = Uint8Array.of(0x19, 1, 90, 0, 0, 0xfa, 0x30, 0);
    const msg = wrapAnt(page, 0x4e);
    expect(msg[0]).toBe(0xa4);
    expect(unwrapAnt(msg)).toEqual(page);
    const broken = msg.slice();
    broken[12] ^= 0xff;
    expect(unwrapAnt(broken)).toBeNull();
  });

  it('reads power and cadence from page 25 and speed from page 16', () => {
    expect(parsePage(Uint8Array.of(0x19, 1, 92, 0, 0, 0x2c, 0x31, 0))).toEqual({
      power: 300,
      cadence: 92,
    });
    expect(parsePage(Uint8Array.of(0x19, 1, 0xff, 0, 0, 0xff, 0x3f, 0))).toEqual({});
    const speed = parsePage(Uint8Array.of(0x10, 25, 0, 0, 0x88, 0x13, 0, 0)); // 5000 mm/s
    expect(speed.speedKmh).toBeCloseTo(18, 5);
  });

  it('encodes track resistance (page 51)', () => {
    const msg = trackResistance(5, 0.004);
    const page = unwrapAnt(msg)!;
    expect(msg[2]).toBe(0x4f);
    expect(page[0]).toBe(0x33);
    expect(page[5] | (page[6] << 8)).toBe(20500); // (5 + 200) / 0.01
    expect(page[7]).toBe(80); // 0.004 / 0.00005
    const flat = unwrapAnt(trackResistance(0))!;
    expect(flat[5] | (flat[6] << 8)).toBe(20000);
  });
});

describe('heart rate', () => {
  it('reads uint8 and uint16 values', () => {
    expect(parseHeartRate(view(0x00, 72))).toBe(72);
    expect(parseHeartRate(view(0x01, 0x2c, 0x01))).toBe(300);
    expect(parseHeartRate(view(0x16, 150, 0x10, 0x03))).toBe(150); // with RR intervals
  });
});
