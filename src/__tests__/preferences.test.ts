jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/diagnostics', () => ({ setDiagnosticDebugMode: jest.fn() }));

async function freshStore(raw: string | null) {
  jest.resetModules();
  const storage = jest.requireMock<typeof import('expo-secure-store')>('expo-secure-store');
  jest.mocked(storage.getItemAsync).mockResolvedValue(raw);
  const state = jest.requireActual<typeof import('../state/app')>('../state/app');
  return { ...state, storage };
}

it.each([null, '{"theme":"dark"}', '{"showAbsentSubjects":"false","septnetGradeDisplay":"invalid"}', 'invalid json'])('缺失或无效偏好保留默认显示方式：%s', async raw => {
  const { useAppStore, hydratePreferences } = await freshStore(raw);
  await hydratePreferences();
  expect(useAppStore.getState()).toMatchObject({ showAbsentSubjects: true, septnetGradeDisplay: 'both' });
});

it('修改偏好保存全部字段，重启后恢复，仍兼容主题设置', async () => {
  const first = await freshStore('{"theme":"dark","seedColor":"#123456"}');
  await first.hydratePreferences();
  first.useAppStore.getState().setShowAbsentSubjects(false);
  first.useAppStore.getState().setSeptnetGradeDisplay('percentile');
  const calls = jest.mocked(first.storage.setItemAsync).mock.calls;
  const [key, raw] = calls.at(-1)!;
  expect(key).toBe('magicmirror.ui.v1');
  expect(JSON.parse(raw)).toEqual({ theme: 'dark', seedColor: '#123456', showAbsentSubjects: false, septnetGradeDisplay: 'percentile' });
  const second = await freshStore(raw);
  await second.hydratePreferences();
  expect(second.useAppStore.getState()).toMatchObject(JSON.parse(raw));
  const writes = jest.mocked(second.storage.setItemAsync);
  expect(writes).toHaveBeenCalledTimes(1);
  expect(JSON.parse(writes.mock.calls[0][1])).toEqual(JSON.parse(raw));
  await second.hydratePreferences();
  expect(writes).toHaveBeenCalledTimes(1);
});
