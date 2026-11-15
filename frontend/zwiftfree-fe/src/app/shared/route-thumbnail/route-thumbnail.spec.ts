import { projectTrack } from './route-thumbnail';

describe('projectTrack', () => {
  it('fits the track into the box with north up', () => {
    const r = projectTrack(
      [
        [8.9, 46.1],
        [9.0, 46.2],
      ],
      100,
      70,
      8,
    )!;
    expect(r.start[1]).toBeGreaterThan(r.end[1]); // south is lower on screen
    for (const p of [r.start, r.end]) {
      expect(p[0]).toBeGreaterThanOrEqual(8);
      expect(p[0]).toBeLessThanOrEqual(92);
      expect(p[1]).toBeGreaterThanOrEqual(8);
      expect(p[1]).toBeLessThanOrEqual(62);
    }
  });

  it('returns null for a single point', () => {
    expect(projectTrack([[8.9, 46.1]], 100, 70, 8)).toBeNull();
  });
});
