/**
 * 真实服务冒烟检查（**默认不参与 `npm test`**：需要联网 + 本人账号）。
 *
 * 口令只经环境变量传入，不落盘、不打印。运行（glob 见下，注意命令行里的通配符）：
 */
//   set SEPTNET_ACCOUNT=<手机号>
//   set SEPTNET_PASSWORD=<明文口令>
//   npx jest --runInBand --testMatch "<rootDir>/src/__tests__/*.check.ts"
/**
 * 只执行**只读**查询：登录 → 学生信息 → 考试列表 → 一场成绩。
 * 不做任何写操作（不调用 exam/SetView、不认领、不修改资料）。
 */
import { createSeptnetProvider } from '@/src/providers/septnet';

const account = process.env.SEPTNET_ACCOUNT ?? '';
const password = process.env.SEPTNET_PASSWORD ?? '';
// 真实随机源（Node 环境；Provider 在 App 内默认使用 expo-crypto）。
const random = (size: number) => globalThis.crypto.getRandomValues(new Uint8Array(size));

jest.setTimeout(120000);

const live = account && password ? it : it.skip;

describe('七天学堂 Provider 联网冒烟（只读）', () => {
  live('登录 → 学生信息 → 考试列表 → 一场成绩', async () => {
    const provider = createSeptnetProvider({ random });
    const session = await provider.authenticate(account, password);
    console.log('[live] 登录与上下文完成');
    expect(session.providerId).toBe('septnet');
    expect(session.providerContext?.['schoolGuid']).toBeTruthy();
    expect(session.providerContext?.['grade']).toBeTruthy();

    const profile = await provider.getProfile(session);
    console.log('[live] 学生信息完成');
    expect(profile.id.length).toBeGreaterThan(0);
    expect(profile.displayName.length).toBeGreaterThan(0);

    const list = await provider.getExamList(session);
    console.log('[live] 考试列表完成');
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    for (const exam of list) {
      expect(exam.id.length).toBeGreaterThan(0);
      expect(exam.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const viewable = list.find((exam) => exam.hasResult) ?? list[0];
    const result = await provider.getExamResult(session, viewable.id);
    expect(result.examId).toBe(viewable.id);
    expect(result.examName.length).toBeGreaterThan(0);
    expect(result.ranking).toBeUndefined();
    for (const subject of result.subjects) {
      expect(subject.subject.length).toBeGreaterThan(0);
      expect(subject.maxScore).toBeGreaterThanOrEqual(0);
    }

    // 只打印形状与计数，不打印姓名/学校/分数等真实数据。
    console.log('[live] 通过', JSON.stringify({
      context: Object.keys(session.providerContext ?? {}),
      hasProfileId: profile.id.length > 0,
      exams: list.length,
      viewableExams: list.filter((exam) => exam.hasResult).length,
      subjects: result.subjects.length,
      hasTotal: typeof result.totalScore === 'number',
      hasPublishedAt: typeof result.publishedAt === 'string',
      subjectFields: result.subjects.map((subject) => Object.keys(subject)),
    }));
  });
});
