import type { QuestionScore } from '@/src/domain/models';
export function flattenQuestions(questions: QuestionScore[]): QuestionScore[] {
  return questions.flatMap((question) => [question, ...flattenQuestions(question.children ?? [])]);
}
export function isWrongQuestion(question: QuestionScore) {
  return question.score !== undefined && question.maxScore !== undefined && question.score < question.maxScore;
}
