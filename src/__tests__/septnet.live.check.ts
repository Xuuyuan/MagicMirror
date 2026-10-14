/**
 * 真实服务冒烟检查（**默认不参与 `npm test`**：需要联网 + 本人账号）。
 *
 * 口令只经环境变量传入，不落盘、不打印。运行（glob 见下，注意命令行里的通配符）：
 */
//   set SEPTNET_ACCOUNT=<手机号>
//   set SEPTNET_PASSWORD=<明文口令>
//   npx jest --runInBand --testMatch "<rootDir>/src/__tests__/*.check.ts"
/**
 * 只执行**只读**查询：登录 → 学生信息 → 考试列表 → 一场成绩 → 试卷原卷/作文/调试字段。
 * 不做任何写操作（不调用 exam/SetView、不认领、不修改资料、不生成 AI 报告、不发短信）。
 */
import { createSeptnetProvider } from '@/src/providers/septnet';
import { z } from 'zod';
import { requestWithTimeout } from '@/src/services/http';
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    jest.requireActual<{ createHash: (algorithm: string) => { update: (value: string) => { digest: (encoding: string) => string } } }>('node:crypto').createHash('sha256').update(value).digest('hex'),
}));

const account = process.env.SEPTNET_ACCOUNT ?? '';
const password = process.env.SEPTNET_PASSWORD ?? '';
// 默认保持原 App 链路；SEPTNET_LOGIN_METHOD=miniapp 时验证小程序 Token 的完整查询兼容性。
const loginMethod = process.env.SEPTNET_LOGIN_METHOD ?? 'app';
// 真实随机源（Node 环境；Provider 在 App 内默认使用 expo-crypto）。
const random = (size: number) => globalThis.crypto.getRandomValues(new Uint8Array(size));

jest.setTimeout(120000);

const live = account && password ? it : it.skip;
async function bindingState(token: string) {
  const response = await requestWithTimeout(fetch, 'https://szone-public.7net.cc/publicszoneui.service/UserService/info', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, version: '4.6.4' }).toString(),
  });
  const parsed = z.object({ status: z.union([z.string(), z.number()]),
    data: z.object({ isWXBind: z.union([z.string(), z.number(), z.boolean()]) }) }).safeParse(await response.json());
  if (!parsed.success || Number(parsed.data.status) !== 200) throw new Error('无法读取微信绑定状态，响应未输出');
  return parsed.data.data.isWXBind;
}

describe('七天学堂 Provider 联网冒烟（只读）', () => {
  live('登录 → 学生信息 → 考试列表 → 一场成绩', async () => {
    const provider = createSeptnetProvider({ random });
    const baseline = loginMethod === 'miniapp' ? await provider.authenticate(account, password) : undefined;
    const bindingBefore = baseline ? await bindingState(baseline.accessToken) : undefined;
    const baselineProfile = baseline ? await provider.getProfile(baseline) : undefined;
    const session = await provider.authenticateWithMethod!(account, password, loginMethod);
    console.log('[live] 登录与上下文完成');
    expect(session.providerId).toBe('septnet');
    expect(session.providerContext?.['schoolGuid']).toBeTruthy();
    expect(session.providerContext?.['grade']).toBeTruthy();

    const profile = await provider.getProfile(session);
    console.log('[live] 学生信息完成');
    expect(profile.id.length).toBeGreaterThan(0);
    expect(profile.displayName.length).toBeGreaterThan(0);
    if (baselineProfile) {
      expect(profile.id === baselineProfile.id).toBe(true);
      const unchanged = bindingBefore === await bindingState(session.accessToken);
      console.log('[live] 小程序登录前后微信绑定标志一致', unchanged);
      expect(unchanged).toBe(true);
      const oldSessionProfile = await provider.getProfile(baseline!);
      expect(oldSessionProfile.id === profile.id).toBe(true);
      console.log('[live] 原 App 会话仍可查询同一学生');
    }

    const list = await provider.getExamList(session);
    console.log('[live] 考试列表完成');
    const unclaimed = await provider.getUnclaimedExams!(session);
    console.log('[live] 待认领考试项数', unclaimed.length);
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
      notice: result.notice?.id ?? null,
      subjectFields: result.subjects.map((subject) => Object.keys(subject)),
    }));

    // 小程序接口面补充能力（原卷/作文/调试字段）：逐项独立校验，缺数据不算失败。
    const scorable = result.subjects.filter((subject) => subject.score !== undefined);
    const target = scorable.find((subject) => subject.subject === '语文') ?? scorable[0];
    if (target) {
      const detail = await provider.getSubjectDetail!(session, result.examId, target.subject, result);
      console.log('[live] 科目详情已返回', !!detail);
      if (provider.getAnswerSheets) {
        const sheets = await provider.getAnswerSheets(session, result.examId, target.subject, result);
        console.log('[live] 答题卡页数', sheets.length);
        for (const sheet of sheets) expect(sheet.url.startsWith('https://')).toBe(true);
      }
      if (provider.getWatermarkedAnswerSheets) {
        const sheets = await provider.getWatermarkedAnswerSheets(session, result.examId, target.subject, result);
        console.log('[live] 标注答题卡页数', sheets.length);
        for (const sheet of sheets) expect(sheet.url.startsWith('https://')).toBe(true);
      }
      if (provider.getPaperImages) {
        const pages = await provider.getPaperImages(session, result.examId, target.subject, result);
        console.log('[live] 试卷原卷页数', pages.length);
        for (const sheet of pages) expect(sheet.url.startsWith('https://')).toBe(true);
      }
      if (provider.getEssayDetail) {
        const essay = await provider.getEssayDetail(session, result.examId, target.subject, result);
        console.log('[live] 作文数据', JSON.stringify({ hasPrompt: !!essay.prompt, promptLength: essay.prompt?.length ?? 0, answerSheets: essay.answerSheets.length }));
        for (const sheet of essay.answerSheets) expect(sheet.url.startsWith('https://')).toBe(true);
      }
      if (provider.getSubjectStatistics) {
        const statistics = await provider.getSubjectStatistics(session, result.examId, target.subject, result);
        console.log('[live] 科目统计项数', statistics.length);
      }
    }
  });
});
