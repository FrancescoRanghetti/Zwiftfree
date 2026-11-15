import { GRADE_COLORS, formatKm, gradeColor } from './grade';

describe('gradeColor', () => {
  it('follows the 3/6/9 % thresholds', () => {
    expect(gradeColor(-8)).toBe(GRADE_COLORS.easy);
    expect(gradeColor(2.9)).toBe(GRADE_COLORS.easy);
    expect(gradeColor(3)).toBe(GRADE_COLORS.moderate);
    expect(gradeColor(6.5)).toBe(GRADE_COLORS.hard);
    expect(gradeColor(9)).toBe(GRADE_COLORS.steep);
    expect(gradeColor(15)).toBe(GRADE_COLORS.steep);
  });

  it('formats kilometres with one decimal', () => {
    expect(formatKm(5832)).toMatch(/^5[.,]8$/);
  });
});
