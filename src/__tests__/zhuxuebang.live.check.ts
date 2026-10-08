/** 手动只读联网检查，默认不参与 npm test；凭据仅由环境变量传入。 */
import { createZhuxuebangProvider } from '@/src/providers/zhuxuebang';

const account = process.env.ZHUXUEBANG_ACCOUNT ?? '';
const password = process.env.ZHUXUEBANG_PASSWORD ?? '';
const live = account && password ? it : it.skip;
jest.setTimeout(120000);

describe('助学帮 Provider 联网冒烟（只读）', () => {
  live('登录、学生、考试、成绩、逐题明细和签名图片 GET', async () => {
    const provider = createZhuxuebangProvider();
    const session = await provider.authenticate(account, password);
    try {
      const profile = await provider.getProfile(session);
      expect(profile.id.length > 0 && profile.displayName.length > 0).toBe(true);
      const exams = await provider.getExamList(session);
      expect(exams.length).toBeGreaterThan(0);
      const exam = exams[0];
      expect(exam.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const result = await provider.getExamResult(session, exam.id);
      expect(result.examId === exam.id).toBe(true);
      expect(result.subjects.length).toBeGreaterThan(0);
      expect(result.subjects.every((item) => !/[（(]赋分[）)]/.test(item.subject))).toBe(true);
      expect(result.subjects.every((item) => item.maxScore !== undefined && item.maxScore > 0)).toBe(true);
      const questionCounts: number[] = [];
      for (const subject of result.subjects) {
        expect(!!subject.id).toBe(true);
        const detail = await provider.getSubjectDetail!(session, exam.id, subject.id!, result);
        const questions = detail.questions?.flatMap((item) => item.children ?? [item]) ?? [];
        questionCounts.push(questions.length);
        expect(questions.length).toBeGreaterThan(0);
        expect(questions.every((item) => item.score === undefined || item.score >= 0)).toBe(true);
        expect(detail.maxScore).toBe(subject.maxScore);
        const summaries = detail.questionScoreSummaries;
        expect(summaries?.length).toBe(2);
        const objective = summaries!.find((item) => item.kind === 'objective')!;
        const subjective = summaries!.find((item) => item.kind === 'subjective')!;
        const rawScore = subject.providerContext?.originalScore !== undefined ? Number(subject.providerContext.originalScore) : subject.score!;
        expect(objective.score + subjective.score).toBeCloseTo(rawScore, 6);
        expect(objective.maxScore + subjective.maxScore).toBeCloseTo(subject.maxScore!, 6);
        expect(subjective.inferred).toBe(true);
        expect(subjective.score >= 0 && subjective.score <= subjective.maxScore).toBe(true);
        const subjectSheets = await provider.getAnswerSheets!(session, exam.id, subject.id!, result);
        expect(subjectSheets.length).toBeGreaterThan(0);
      }
      const sheets = await provider.getAnswerSheets!(session, exam.id, result.subjects[0].id!, result);
      expect(sheets.length).toBeGreaterThan(0);
      expect(sheets.every((item) => !item.watermarked && !item.headers)).toBe(true);
      try {
        const image = await fetch(sheets[0].url, { signal: AbortSignal.timeout(18000), redirect: 'error' });
        expect(image.status).toBe(200);
        expect(image.headers.get('content-type')?.startsWith('image/')).toBe(true);
        await image.body?.cancel();
      } catch { throw new Error('助学帮签名图片 GET 检查失败（详情已隐藏）'); }
      console.log('[live] 助学帮通过', JSON.stringify({ exams: exams.length, subjects: result.subjects.length, questionCounts, sheets: sheets.length, hasTotal: result.totalScore !== undefined }));
    } finally { await provider.logout(session); }
  });
});
