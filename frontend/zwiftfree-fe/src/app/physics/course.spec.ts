import { Course, courseFromRoute } from './course';
import { NODES, line } from './testing';

describe('Course', () => {
  const twoLegs = () => {
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
  };

  it('measures legs and finds positions', () => {
    const c = twoLegs();
    expect(c.lengthM).toBeCloseTo(200.1, 0);
    expect(c.legs[1].startM).toBeCloseTo(100.07, 1);
    const p = c.pointAt(150);
    expect(p.legIndex).toBe(1);
    expect(p.edgeId).toBe(23);
    expect(p.edgeOffsetM).toBeCloseTo(150 - c.legs[1].startM, 3);
    expect(p.lat).toBeGreaterThan(46.0009);
    expect(p.ele).toBeGreaterThan(205);
    expect(c.pointAt(-10).lat).toBe(46.0);
    expect(c.pointAt(1e6).lat).toBeCloseTo(46.0018, 6);
  });

  it('computes grade over a window that crosses legs', () => {
    const c = twoLegs();
    expect(c.gradeAt(50)).toBeCloseTo(5, 0); // +5 m over 100 m
    expect(c.gradeAt(150)).toBeCloseTo(10, 0); // +10 m over 100 m
    const atJunction = c.gradeAt(c.legs[1].startM);
    expect(atJunction).toBeGreaterThan(6);
    expect(atJunction).toBeLessThan(9);
  });

  it('heads north', () => {
    expect(twoLegs().headingAt(50)).toBeCloseTo(0, 0);
  });

  it('cuts at a distance and drops later legs', () => {
    const c = twoLegs();
    c.cutAt(55);
    expect(c.legs.length).toBe(1);
    expect(c.lengthM).toBeCloseTo(55, 1);
  });

  it('returns ridden coordinates with interpolated ends', () => {
    const pts = twoLegs().coordsBetween(5, 125);
    expect(pts[0][1]).toBeGreaterThan(46.0);
    expect(pts.length).toBeGreaterThan(10);
  });

  it('builds a profile every 50 m', () => {
    const prof = twoLegs().profile();
    expect(prof[0][0]).toBe(0);
    expect(prof[1][0]).toBe(50);
    expect(prof[prof.length - 1][1]).toBeCloseTo(215, 0);
  });

  it('splits a planned route by edge starts', () => {
    const coords = [...line(NODES[1], NODES[2]), ...line(NODES[2], NODES[3]).slice(1)];
    const c = courseFromRoute(coords, [12, 23], [1, 1], [0, 100.07]);
    expect(c.legs.map((l) => l.edgeId)).toEqual([12, 23]);
    expect(c.legs[0].pts.length).toBe(11);
    expect(c.lengthM).toBeCloseTo(200.1, 0);
  });

  it('keeps a stale route as one leg without edge ids', () => {
    const coords = line(NODES[1], NODES[3]);
    const c = courseFromRoute(coords, [12, 23], [1, 1], null);
    expect(c.legs.length).toBe(1);
    expect(c.legs[0].edgeId).toBeNull();
  });

  it('reports the edge offset for reversed legs', () => {
    const c = new Course();
    c.append({
      edgeId: 12,
      direction: -1,
      edgeOffsetStartM: 100,
      endNode: 1,
      pts: line(NODES[2], NODES[1]),
    });
    expect(c.pointAt(30).edgeOffsetM).toBeCloseTo(70, 3);
  });
});
