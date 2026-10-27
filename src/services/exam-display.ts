import type { ExamResult } from '../domain/models';

/** Preserve the selected exam's name when a report only supplies a generic title. */
export function examDisplayName(
  result: Pick<ExamResult, 'examName' | 'examNameIsFallback'> | undefined,
  selectedName?: string,
): string | undefined {
  const reported = result?.examName.trim();
  if (reported && !result?.examNameIsFallback) return reported;
  return selectedName?.trim() || reported || undefined;
}
