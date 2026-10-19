/** 手动只读检查：不调用 bindExam，凭据和本人考号仅从当前进程环境读取。 */
import { createZhuxuebangProvider } from '../providers/zhuxuebang';

const account = process.env.ZHUXUEBANG_ACCOUNT ?? '';
const password = process.env.ZHUXUEBANG_PASSWORD ?? '';
const examName = process.env.ZHUXUEBANG_BINDING_EXAM ?? '';
const studentCode = process.env.ZHUXUEBANG_BINDING_CODE ?? '';
const live = account && password && examName && studentCode ? it : it.skip;
jest.setTimeout(90000);

live('实际 Provider 搜索与已绑定预览（只读）', async () => {
  const provider = createZhuxuebangProvider();
  const session = await provider.authenticate(account, password);
  try {
    const projects = await provider.getSearchableExams!(session);
    const matches = projects.filter((item) => item.name === examName);
    expect(matches.length).toBe(1);
    const before = await provider.getExamList(session);
    expect(before.some((item) => item.id === matches[0].id)).toBe(true);
    const preview = await provider.previewExamBinding!(session, matches[0].id, studentCode);
    expect(preview.status).toBe('already-bound');
    const after = await provider.getExamList(session);
    expect(after.length).toBe(before.length);
    expect(after.every((item) => before.some((previous) => previous.id === item.id))).toBe(true);
    console.log('[live] 搜索考试项目及已关联处理通过；未调用绑定接口');
  } finally {
    await provider.logout(session);
  }
});
