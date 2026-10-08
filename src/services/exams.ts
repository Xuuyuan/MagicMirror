import type { ExamSummary } from '@/src/domain/models';

export function mergeExamPages(pages: ExamSummary[][]): ExamSummary[] {
  return [...new Map(pages.flat().map((exam) => [exam.id, exam])).values()];
}

export function hasMoreExamPages(lastPage: ExamSummary[], previousPages: ExamSummary[][]): boolean {
  if (!lastPage.length) return false;
  const previousIds = new Set(previousPages.flat().map((exam) => exam.id));
  return lastPage.some((exam) => !previousIds.has(exam.id));
}
