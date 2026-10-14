import { createZhuxuebangProvider } from '../providers/zhuxuebang';
import type { AuthSession, ExamBindingCandidate } from '../domain/models';

const session: AuthSession = { providerId: 'zhuxuebang', accountId: 'fictional', accessToken: 'fictional-token', providerContext: { studentId: '11' } };
const profile = { id: 11, stuName: '虚构学生', schId: 22 };
const projects = [{ examNo: 1001, examPno: 0, examName: '虚构考试' }];
const info = { schName: '虚构学校', stuName: profile.stuName, claName: '虚构班级', stuNo: '001234' };
const candidate: ExamBindingCandidate = { examId: '1001', examName: '虚构考试', studentId: '11', studentCode: '001234', displayName: info.stuName, schoolName: info.schName, className: info.claName };
const ok = (datas: unknown) => ({ code: 200, datas });
const duplicate = { code: -6000, message: '您已经关联过本场考试，在首页选择相应考试项目即可直接查询！', datas: null };
function setup(responses: unknown[]) {
  const transport = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return { status: 200, json: async () => response } as Response;
  });
  return { transport, provider: createZhuxuebangProvider({ transport }) };
}
const body = (transport: ReturnType<typeof setup>['transport'], index: number) => JSON.parse(String(transport.mock.calls[index][1]?.body));
const preflight = () => [ok(profile), ok(projects), ok(info)];

it('只读取当前学校的项目，转换 ID 且不捏造日期', async () => {
  const { provider, transport } = setup([ok(profile), ok(projects)]);
  await expect(provider.getSearchableExams!(session)).resolves.toEqual([{ id: '1001', name: '虚构考试' }]);
  expect(body(transport, 1)).toEqual({ schId: 22 });
  expect(new Headers(transport.mock.calls[1][1]?.headers).get('stuId')).toBe('11');
});

it('保留考号前导零，预览仅返回匹配本人的信息且不绑定', async () => {
  const { provider, transport } = setup(preflight());
  await expect(provider.previewExamBinding!(session, '1001', ' 001234 ')).resolves.toEqual({ status: 'ready', candidate });
  expect(body(transport, 2)).toEqual({ stuId: 11, examNo: 1001, stuNo: '001234' });
  expect(transport.mock.calls.some(([url]) => String(url).endsWith('/BindStuExam'))).toBe(false);
});

it.each(['', '   '])('空考号 %j 在本地阻止请求', async (code) => {
  const { provider, transport } = setup([]);
  await expect(provider.previewExamBinding!(session, '1001', code)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(transport).not.toHaveBeenCalled();
});

it('缺少学校、学生不匹配及项目不属于本校时不继续核对', async () => {
  for (const responses of [[ok({ ...profile, schId: null })], [ok({ ...profile, id: 12 })], [ok(profile), ok([])]]) {
    const { provider, transport } = setup(responses);
    await expect(provider.previewExamBinding!(session, '1001', '001234')).rejects.toThrow();
    expect(transport.mock.calls.some(([url]) => String(url).endsWith('/GetStuExamInfo'))).toBe(false);
  }
});

it.each([{ stuName: '虚构其他人' }, { stuNo: '009999' }])('姓名或返回考号不符拒绝绑定：%j', async (changes) => {
  const { provider, transport } = setup([ok(profile), ok(projects), ok({ ...info, ...changes })]);
  await expect(provider.bindExam!(session, candidate)).rejects.toMatchObject({ code: 'RESTRICTED' });
  expect(transport).toHaveBeenCalledTimes(3);
});

it('确认后重新核对全部字段，班级变化也要求重新确认', async () => {
  const { provider, transport } = setup([ok(profile), ok(projects), ok({ ...info, claName: '虚构新班级' })]);
  await expect(provider.bindExam!(session, candidate)).rejects.toThrow('信息已变化');
  expect(transport).toHaveBeenCalledTimes(3);
});

it('确认对象属于另一学生时零请求拒绝', async () => {
  const { provider, transport } = setup([]);
  await expect(provider.bindExam!(session, { ...candidate, studentId: '12' })).rejects.toThrow('学生已变更');
  expect(transport).not.toHaveBeenCalled();
});

it('首次绑定 code=200/datas=null 即成功，仅提交一次', async () => {
  const { provider, transport } = setup([...preflight(), ok(null)]);
  await expect(provider.bindExam!(session, candidate)).resolves.toEqual({ status: 'bound' });
  expect(transport).toHaveBeenCalledTimes(4);
  expect(String(transport.mock.calls[3][0])).toBe('https://stuquery.wylkyj.com/api/v1/exam/BindStuExam');
  expect(body(transport, 3)).toEqual({ stuId: 11, examNo: 1001, stuNo: '001234' });
});

it('已关联预览不说明输入考号正确；返回独立状态且不再次写入', async () => {
  const { provider, transport } = setup([ok(profile), ok(projects), duplicate]);
  await expect(provider.previewExamBinding!(session, '1001', '009999')).resolves.toEqual({ status: 'already-bound' });
  expect(transport).toHaveBeenCalledTimes(3);
  const binding = setup([ok(profile), ok(projects), duplicate]);
  await expect(binding.provider.bindExam!(session, candidate)).resolves.toEqual({ status: 'already-bound' });
  expect(binding.transport).toHaveBeenCalledTimes(3);
});

it('提交时遇到重复绑定也返回独立状态，不重试', async () => {
  const { provider, transport } = setup([...preflight(), duplicate]);
  await expect(provider.bindExam!(session, candidate)).resolves.toEqual({ status: 'already-bound' });
  expect(transport).toHaveBeenCalledTimes(4);
});

it('错误考号提供明确提示，未知 -6000 不冒充已关联', async () => {
  const invalid = setup([ok(profile), ok(projects), { code: -1000, message: '准考证号不存在', datas: null }]);
  await expect(invalid.provider.previewExamBinding!(session, '1001', '009999')).rejects.toThrow('准考证号不存在');
  const other = setup([ok(profile), ok(projects), { code: -6000, message: '其他失败', datas: null }]);
  await expect(other.provider.previewExamBinding!(session, '1001', '001234')).rejects.toMatchObject({ code: 'UNKNOWN' });
});

it.each([new Error('fictional transport failure'), { datas: null }, { code: 401 }])('提交失败不重试且不产生会话恢复重放信号', async (response) => {
  const { provider, transport } = setup([...preflight(), response]);
  await expect(provider.bindExam!(session, candidate)).rejects.not.toMatchObject({ code: 'SESSION_EXPIRED' });
  expect(transport).toHaveBeenCalledTimes(4);
});

it('预览返回字段结构不完整时不允许确认', async () => {
  const { provider } = setup([ok(profile), ok(projects), ok({ stuName: profile.stuName, stuNo: info.stuNo })]);
  await expect(provider.previewExamBinding!(session, '1001', '001234')).rejects.toThrow('考生核对结构');
});

it('取消后不发送预览或绑定请求', async () => {
  const { provider, transport } = setup([]);
  const controller = new AbortController(); controller.abort();
  await expect(provider.bindExam!(session, candidate, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(transport).not.toHaveBeenCalled();
});
