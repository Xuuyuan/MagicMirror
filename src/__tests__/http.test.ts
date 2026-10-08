import { requestWithTimeout } from '@/src/services/http';

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
