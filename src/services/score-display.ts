export const gradeDisplayOptions = [
  { mode: 'both', label: '等第及百分比均显示' },
  { mode: 'grade', label: '只显示等第' },
  { mode: 'percentile', label: '只显示百分比' },
  { mode: 'none', label: '不显示' },
] as const;
export type GradeDisplayMode = typeof gradeDisplayOptions[number]['mode'];
export function isGradeDisplayMode(mode: unknown): mode is GradeDisplayMode {
  return gradeDisplayOptions.some(option => option.mode === mode);
}

export function formatGradeLabel(providerId: string | undefined, grade: string | undefined, percentile: string | undefined, mode: GradeDisplayMode): string | undefined {
  if (providerId === 'septnet') {
    if (mode === 'none') return undefined;
    if (mode === 'grade') return grade || undefined;
    if (mode === 'percentile') return percentile || undefined;
  }
  return grade ? [grade, percentile].filter(Boolean).join(' ') : undefined;
}
