/** Grade colour scale shared by the map and the elevation profile (spec: <3 green, 3–6 yellow, 6–9 orange, >9 red). */
export const GRADE_COLORS = {
  easy: '#43a047',
  moderate: '#fdd835',
  hard: '#fb8c00',
  steep: '#e53935',
} as const;

export const GRADE_STEPS = [
  { max: 3, color: GRADE_COLORS.easy, label: '< 3%' },
  { max: 6, color: GRADE_COLORS.moderate, label: '3–6%' },
  { max: 9, color: GRADE_COLORS.hard, label: '6–9%' },
  { max: Infinity, color: GRADE_COLORS.steep, label: '> 9%' },
] as const;

export function gradeColor(gradePercent: number): string {
  for (const s of GRADE_STEPS) if (gradePercent < s.max) return s.color;
  return GRADE_COLORS.steep;
}

export function formatKm(m: number): string {
  return (m / 1000).toLocaleString('it-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatM(m: number): string {
  return Math.round(m).toLocaleString('it-CH');
}
