/**
 * 真实服务冒烟检查（**默认不参与 `npm test`**：需要联网 + 本人账号）。
 *
 * 凭据只经环境变量传入，不落盘、不打印。运行（glob 见下，注意命令行里的通配符）：
 */
//   set HAITUN_ACCOUNT=<手机号>
//   set HAITUN_PASSWORD=<明文口令>
//   npx jest --runInBand --testMatch "<rootDir>/src/__tests__/*.check.ts"
/**
 * 只执行**只读**查询：登录 → 学生信息 → 考试列表 → 一场成绩 → 科目小分 → 答题卡。
 * 不做任何写操作（不购买会员、不修改资料）。
 */
import { createHaitunyuejuanProvider } from '@/src/providers/haitunyuejuan';

const account = process.env.HAITUN_ACCOUNT ?? '';
const password = process.env.HAITUN_PASSWORD ?? '';

jest.setTimeout(120000);

const live = account && password ? it : it.skip;

describe('海豚阅卷 Provider 联网冒烟（只读）', () => {
  live('登录 → 学生信息 → 考试列表 → 一场成绩 → 科目小分 → 答题卡', async () => {
    const provider = createHaitunyuejuanProvider();
    const session = await provider.authenticate(account, password);
    console.log('[live] 登录与上下文完成');
    expect(session.providerId).toBe('haitunyuejuan');
    expect(session.providerContext?.['bindingId']).toBeTruthy();
    expect(session.providerContext?.['studentId']).toBeTruthy();
    expect(session.expiresAt).toBeGreaterThan(Date.now());

    const profile = await provider.getProfile(session);
    console.log('[live] 学生信息完成');
    expect(profile.displayName.length).toBeGreaterThan(0);

    const list = await provider.getExamList(session);
    console.log('[live] 考试列表完成');
    expect(list.length).toBeGreaterThan(0);
    for (const exam of list) {
      expect(exam.id).toMatch(/^\d+$/);
      expect(exam.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const latest = list[0];
    const result = await provider.getExamResult(session, latest.id);
    expect(result.examName.length).toBeGreaterThan(0);
    expect(result.ranking?.scope).toBe('grade');
    for (const subject of result.subjects) {
      expect(subject.id).toMatch(/^\d+$/);
      expect(subject.subject.length).toBeGreaterThan(0);
    }

    const subject = result.subjects[0];
    const detail = await provider.getSubjectDetail!(session, latest.id, subject.id!, result);
    expect(detail.subject).toBe(subject.subject);
    console.log('[live] 科目明细完成', JSON.stringify({
      questions: detail.questions?.length,
      summaries: detail.questionScoreSummaries?.length,
      statistics: detail.statistics?.length,
    }));

    const sheets = await provider.getAnswerSheets!(session, latest.id, subject.id!, result);
    console.log('[live] 答题卡完成');
    for (const sheet of sheets) {
      expect(sheet.url).toMatch(/^http:\/\//);
      expect(sheet.watermarked).toBe(false);
      expect(sheet.headers).toBeUndefined();
    }

    // 刷新链路：一次性 refreshToken 轮换后旧令牌作废，新令牌必须写回会话。
    const refreshed = await provider.refreshSession!(session);
    expect(refreshed.accessToken).not.toBe(session.accessToken);
    expect(refreshed.providerContext?.['refreshToken']).not.toBe(session.providerContext?.['refreshToken']);
    expect(refreshed.providerContext?.['bindingId']).toBe(session.providerContext?.['bindingId']);
    const afterRefresh = await provider.getExamList(refreshed);
    expect(afterRefresh.length).toBeGreaterThan(0);

    // 只打印形状与计数，不打印姓名/学校/分数等真实数据。
    console.log('[live] 通过', JSON.stringify({
      context: Object.keys(session.providerContext ?? {}),
      exams: list.length,
      subjects: result.subjects.length,
      hasTotal: typeof result.totalScore === 'number',
      hasRanking: result.ranking !== undefined,
      questions: detail.questions?.length ?? 0,
      sheets: sheets.length,
    }));
  });
});
