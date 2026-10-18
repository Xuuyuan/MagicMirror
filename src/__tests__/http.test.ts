import { requestWithTimeout } from '@/src/services/http';
import { clearDiagnostics, diagnosticSnapshot, setDiagnosticDebugMode } from '@/src/services/diagnostics';

it('records complete request and response bodies and Cookie headers only in debug mode', async () => {
  const url = 'https://example.invalid/report?examId=fictional-exam';
  const body = JSON.stringify({ score: 123, token: 'fictional-token' });
  const transport = jest.fn(async () => ({
    status: 200, headers: new Headers({ 'set-cookie': 'session=fictional-response' }),
    clone: () => ({ text: async () => body }),
  } as Response));
  const init = { method: 'POST', headers: { Cookie: 'session=fictional-request' }, body: 'fictional-request-body' };
  clearDiagnostics();
  try {
    setDiagnosticDebugMode(false);
    await requestWithTimeout(transport, url, init);
    expect(diagnosticSnapshot()).toEqual([]);
    setDiagnosticDebugMode(true);
    const response = await requestWithTimeout(transport, url, init);
    expect(diagnosticSnapshot()).toEqual([expect.objectContaining({
      request: { url, method: 'POST', headers: { cookie: 'session=fictional-request' }, body: init.body },
      response: { status: 200, headers: { 'set-cookie': 'session=fictional-response' }, body },
    })]);
    expect(response).toBe(await transport.mock.results[1].value);
  } finally { clearDiagnostics(); setDiagnosticDebugMode(false); }
});

it('aborts a hanging transport at the timeout without retrying', async () => {
  jest.useFakeTimers();
  try {
    const transport = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const request = requestWithTimeout(transport, 'https://example.invalid', {}, 25);
    jest.advanceTimersByTime(25);
    await expect(request).rejects.toThrow('aborted');
    expect(transport).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

it('保留调用方的取消信号并转发为 AbortSignal', async () => {
  const upstream = new AbortController();
  const transport = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const request = requestWithTimeout(transport, 'https://example.invalid', { signal: upstream.signal }, 1000);
  upstream.abort();
  await expect(request).rejects.toThrow('aborted');
  expect(transport).toHaveBeenCalledWith('https://example.invalid', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
