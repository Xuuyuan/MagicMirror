/** 手动只读联网检查，默认不参与 npm test；凭据仅由环境变量传入。 */
import { createZhuxuebangProvider } from '@/src/providers/zhuxuebang';

const account = process.env.ZHUXUEBANG_ACCOUNT ?? '';
const password = process.env.ZHUXUEBANG_PASSWORD ?? '';
const live = account && password ? it : it.skip;
jest.setTimeout(120000);

describe('助学帮网页版/小程序双通道联网冒烟（只读）', () => {
  live('双通道登录成功，全部考试两种 source 返回一致成绩', async () => {
    const provider = createZhuxuebangProvider();
    // 未标记通道 = 网页版默认；小程序通道显式标记，两个会话指向同一学生。
    const web = await provider.authenticate(account, password);
    const miniapp = await provider.authenticateWithMethod!(account, password, 'miniapp');
    try {
      expect(web.providerContext?.loginMethod).toBeUndefined();
      expect(miniapp.providerContext?.loginMethod).toBe('miniapp');
      expect(web.providerContext?.studentId).toBe(miniapp.providerContext?.studentId);
      const exams = await provider.getExamList(web);
      expect(exams.length).toBeGreaterThan(0);
      // 网页版 source: 2 与小程序 source: 1 在当前全部已绑定考试上必须给出一致结果。
      for (const exam of exams) {
        const webResult = await provider.getExamResult(web, exam.id);
        const miniResult = await provider.getExamResult(miniapp, exam.id);
        expect(webResult).toEqual(miniResult);
      }
      console.log('[live] 双通道通过', JSON.stringify({ exams: exams.length }));
    } finally {
      await provider.logout(web);
      await provider.logout(miniapp);
    }
  });
});
