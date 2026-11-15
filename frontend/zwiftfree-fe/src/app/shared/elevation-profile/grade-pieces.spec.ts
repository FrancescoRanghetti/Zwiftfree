import { GRADE_COLORS } from '../grade';
import { gradePieces } from './elevation-profile';

describe('gradePieces', () => {
  it('merges consecutive steps of the same grade class into km ranges', () => {
    const pieces = gradePieces([
      [0, 200, 0],
      [50, 201, 2],
      [100, 202, 2],
      [150, 206, 8],
      [200, 211, 10],
      [250, 211, 0],
    ]);
    expect(pieces.map((p) => p.color)).toEqual([
      GRADE_COLORS.easy,
      GRADE_COLORS.hard,
      GRADE_COLORS.steep,
      GRADE_COLORS.easy,
    ]);
    expect(pieces[0]).toMatchObject({ gte: 0, lt: 0.1 });
    expect(pieces[1]).toMatchObject({ gte: 0.1, lt: 0.15 });
    expect(pieces[3].gte).toBe(0.2);
    expect(pieces[3].lt).toBeGreaterThan(0.25);
  });

  it('is empty for a single point', () => {
    expect(gradePieces([[0, 200, 0]])).toEqual([]);
  });
});
