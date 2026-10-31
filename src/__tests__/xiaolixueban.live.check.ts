/**
 * 真实服务冒烟检查（**默认不参与 `npm test`**：需要联网 + 本人账号）。
 *
 * 凭据只经环境变量传入，不落盘、不打印。运行：
 */
//   set XIAOLIXUEBAN_ACCOUNT=<手机号>
//   set XIAOLIXUEBAN_PASSWORD=<明文口令>
//   npx jest --runInBand --testMatch "<rootDir>/src/__tests__/*.live.check.ts"
/**
 * 只执行**只读**查询：登录 → 学生信息 → 考试列表 → 一场成绩 → 一个科目 → 答题卡。
 * 不做任何写操作（不提交、不申诉、不购买、不改资料）。
 */
import { createXiaolixuebanProvider } from '@/src/providers/xiaolixueban';

const account = process.env.XIAOLIXUEBAN_ACCOUNT ?? '';
const password = process.env.XIAOLIXUEBAN_PASSWORD ?? '';

jest.setTimeout(180000);

const live = account && password ? it : it.skip;

describe('小力学伴 Provider 联网冒烟（只读）', () => {
  live('登录 → 学生信息 → 考试列表 → 一场成绩 → 科目明细 → 答题卡', async () => {
    const provider = createXiaolixuebanProvider();
    const session = await provider.authenticate(account, password);
    console.log('[live] 登录与上下文完成');
    expect(session.providerId).toBe('xiaolixueban');
    expect(session.accessToken.length).toBeGreaterThan(0);
    expect(session.providerContext?.['studentId']).toBeTruthy();
    expect(session.providerContext?.['portalCookie']).toBeTruthy();

    const profile = await provider.getProfile(session);
    expect(profile.displayName.length).toBeGreaterThan(0);
    console.log('[live] 学生信息完成');

    const profiles = await provider.getProfiles!(session);
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles.filter((item) => item.selected)).toHaveLength(1);

    const list = await provider.getExamList(session);
    console.log('[live] 考试列表完成');
    expect(list.length).toBeGreaterThan(0);
    for (const exam of list) {
      expect(exam.id).toMatch(/^\d+$/);
      if (exam.date !== undefined) expect(exam.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    let checked:
      | {
          examId: string;
          subjects: number;
          hasTotal: boolean;
          hasOriginalTotal: boolean;
          rankings: number;
          sections: number;
          questions: number;
          questionScoresMatchTotal: boolean;
          sheets: number;
          detailSections: number;
          statistics: number;
          examScopes: string[];
          detailScopes: string[];
          rankLabels: string[];
        }
      | undefined;
    // 优先挑一场联考（官方总分+排名齐全），其次挑有总分的考试。
    const candidates: {
      result: Awaited<ReturnType<typeof provider.getExamResult>>;
      examId: string;
    }[] = [];
    for (const exam of list.slice(0, 6)) {
      try {
        const result = await provider.getExamResult(session, exam.id);
        if (result.subjects.length) candidates.push({ result, examId: exam.id });
      } catch (error) {
        console.log('[live] 跳过一场考试', (error as Error).message);
      }
      if (candidates.some((item) => item.result.isUnion === true)) break;
    }
    const picked =
      candidates.find(
        (item) => item.result.isUnion === true && typeof item.result.totalScore === 'number',
      ) ??
      candidates.find((item) => typeof item.result.totalScore === 'number') ??
      candidates[0];
    // 只打印各候选考试的科目数，确认“未发布单科报告”的考试也能补全多科。
    console.log(
      '[live] 候选科目数',
      JSON.stringify(candidates.map((item) => item.result.subjects.length)),
    );
    if (picked) {
      const { result, examId } = picked;
      // 联考排名统一显示为“联考”，联考卡片只给均分。
      expect(result.defeatRates).toBeUndefined();
      for (const ranking of result.rankings ?? []) {
        if (ranking.scope === 'group') expect(ranking.label).toBe('联考排名');
      }
      for (const stat of result.statistics ?? []) {
        if (stat.scope === '联考') expect(stat.averageScore).toBeDefined();
      }
      const subject = result.subjects.find((item) => item.id !== undefined);
      expect(subject).toBeDefined();
      const detail = await provider.getSubjectDetail!(session, examId, subject!.id!, result);
      // 逐题得分合计应与科目总分一致（区域赋分考试的真实得分来自 error/analysis）。
      const questionScoreSum = (detail.questions ?? []).reduce(
        (total, question) => total + (question.score ?? 0),
        0,
      );
      const questionScoresMatchTotal =
        detail.score !== undefined &&
        (detail.questions?.length ?? 0) > 0 &&
        Math.abs(questionScoreSum - detail.score) < 0.01;
      expect(questionScoresMatchTotal).toBe(true);
      // “学科统计”卡片已删除。
      expect(
        detail.reportSections?.some((item) => item.id === 'xiaolixueban-subject-stats') ?? false,
      ).toBe(false);
      let sheets: Awaited<ReturnType<NonNullable<typeof provider.getAnswerSheets>>> = [];
      try {
        sheets = await provider.getAnswerSheets!(session, examId, subject!.id!, result);
      } catch {
        sheets = [];
      }
      checked = {
        examId,
        subjects: result.subjects.length,
        hasTotal: typeof result.totalScore === 'number',
        hasOriginalTotal: typeof result.originalTotalScore === 'number',
        rankings: (result.rankings ?? (result.ranking ? [result.ranking] : [])).length,
        sections: result.reportSections?.length ?? 0,
        questions: detail.questions?.length ?? 0,
        questionScoresMatchTotal,
        detailSections: detail.reportSections?.length ?? 0,
        statistics: detail.statistics?.length ?? 0,
        sheets: sheets.length,
        // 只打印统计卡片的 scope（如“年级/班级/联考”），不打印数值。
        examScopes: result.statistics?.map((stat) => stat.scope) ?? [],
        detailScopes: detail.statistics?.map((stat) => stat.scope) ?? [],
        rankLabels: (result.rankings ?? []).map(
          (ranking) => ranking.label ?? ranking.scope ?? '未标注',
        ),
      };
      for (const sheet of sheets) {
        expect(sheet.url).toMatch(/^https:\/\/cdn\.dongni100\.com\//);
        expect(sheet.watermarked).toBe(false);
        expect(sheet.headers).toBeUndefined();
      }
    }
    expect(checked).toBeDefined();

    // 未发布单科报告的考试：补全出来的科目（id 以“原始报告”statId 开头）应能打开详情并拿到逐题。
    const fallbackCandidate = candidates.find(
      (item) =>
        item.examId !== picked?.examId &&
        item.result.subjects.some((subject) => subject.id?.startsWith('0:')),
    );
    if (fallbackCandidate) {
      // 分数段接口给出本人总分与分布；官方没有班级/年级排名时用分布估算区间名次。
      expect(typeof fallbackCandidate.result.totalScore).toBe('number');
      expect(fallbackCandidate.result.maxTotalScore).toBeGreaterThan(0);
      const estimatedScopes = (fallbackCandidate.result.rankings ?? [])
        .filter((ranking) => ranking.estimate)
        .map((ranking) => ranking.scope);
      expect(estimatedScopes).toContain('class');
      expect(estimatedScopes).toContain('grade');
      expect(
        fallbackCandidate.result.reportSections?.some(
          (section) => section.id === 'xiaolixueban-score-distribution',
        ) ?? false,
      ).toBe(true);
      const subject = fallbackCandidate.result.subjects.find((item) => item.id?.startsWith('0:'));
      const detail = await provider.getSubjectDetail!(
        session,
        fallbackCandidate.examId,
        subject!.id!,
        fallbackCandidate.result,
      );
      expect(detail.questions?.length ?? 0).toBeGreaterThan(0);
      console.log('[live] 补全科目详情题数', detail.questions?.length ?? 0);
    }

    // 只打印形状与计数，不打印姓名、学校、分数等真实数据。
    console.log('[live] 通过', JSON.stringify({ exams: list.length, ...checked }));
  });
});
