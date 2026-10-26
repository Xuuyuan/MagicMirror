import { zhixueLoginScript } from '../providers/zhixue-login';

const { runInNewContext } = jest.requireActual<{
  runInNewContext: (code: string, context: object) => unknown;
}>('node:vm');

function setup() {
  const cookies = new Map([
    ['www', 'old-session'],
    ['container', 'old-session'],
    ['other-platform', 'keep'],
  ]);
  const fetch = jest.fn(async (path: string, options: RequestInit) => {
    if (options.signal?.aborted) throw new Error('fictional cancellation');
    cookies.delete(path === '/ssoservice.jsp' ? 'www' : 'container');
    return { ok: true, redirected: false, text: async () => 'success\n' };
  });
  const replace = jest.fn();
  const postMessage = jest.fn();
  const listeners = new Map<string, () => void>();
  const window = {
    top: undefined as unknown,
    ReactNativeWebView: { postMessage },
    addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
  };
  window.top = window;
  const environment = {
    window,
    location: { pathname: '/loginState/', replace },
    document: { body: { textContent: '' } },
    fetch,
    AbortController,
    setTimeout: jest.fn(),
    clearTimeout: jest.fn(),
  };
  const run = () => runInNewContext(zhixueLoginScript('fictional-attempt'), environment);
  return { run, fetch, replace, postMessage, listeners, cookies, environment };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

it('logs out both official services before CAS redirects back to the mobile form, preserving unrelated cookies', async () => {
  const test = setup();
  test.run();
  test.run();
  await flush();
  expect(test.fetch.mock.calls.map(([path]) => path)).toEqual([
    '/ssoservice.jsp',
    '/container/ssoservice.jsp',
  ]);
  for (const call of test.fetch.mock.calls) {
    expect(call[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: 'action=logout',
    });
  }
  expect(test.cookies.has('www')).toBe(false);
  expect(test.cookies.has('container')).toBe(false);
  expect(test.cookies.get('other-platform')).toBe('keep');
  expect(test.replace).toHaveBeenCalledTimes(1);
  const logout = new URL(test.replace.mock.calls[0][0]);
  expect(logout.origin).toBe('https://sso.zhixue.com');
  expect(logout.pathname).toBe('/sso_alpha/logout');
  const login = new URL(logout.searchParams.get('service')!);
  expect(login.pathname).toBe('/wap_login.html');
  expect(login.searchParams.get('nextpage')).toBe(
    'https://www.zhixue.com/container/container/parent/index/',
  );
  expect(test.postMessage).not.toHaveBeenCalled();
});
it.each(['network', 'unexpected-response', 'redirect'])(
  'stops rather than reusing the previous account after %s',
  async (failure) => {
    const test = setup();
    if (failure === 'network')
      test.fetch.mockRejectedValueOnce(new Error('fictional network failure'));
    else
      test.fetch.mockResolvedValueOnce({
        ok: true,
        redirected: failure === 'redirect',
        text: async () => '<html>login</html>',
      });
    test.run();
    await flush();
    expect(test.replace).not.toHaveBeenCalled();
    expect(test.postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        kind: 'official-login-error',
        attemptId: 'fictional-attempt',
      }),
    );
  },
);
it('does not navigate or report a login after cancellation', async () => {
  const test = setup();
  test.run();
  test.listeners.get('pagehide')!();
  await flush();
  expect(test.replace).not.toHaveBeenCalled();
  expect(test.postMessage).not.toHaveBeenCalled();
});
