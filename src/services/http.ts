import { debugModeEnabled, diagnosticEndpoint, recordDiagnostic } from './diagnostics';
export type FetchTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
function debugBody(body: BodyInit | null | undefined): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  try { return JSON.stringify(body); } catch { return String(body); }
}
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  throw error;
}
export async function requestWithTimeout(transport: FetchTransport, url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  throwIfAborted(init.signal);
  const controller = new AbortController();
  let timedOut = false;
  const started = Date.now();
  const endpoint = diagnosticEndpoint(url);
  const headers = new Headers(init.headers);
  const debug = debugModeEnabled();
  const request = debug ? { url, method: init.method ?? 'GET', headers: Object.fromEntries(headers.entries()), ...(debugBody(init.body) !== undefined ? { body: debugBody(init.body) } : {}) } : undefined;
  const ua = headers.get('User-Agent') ?? '';
  const metadata = { credentials: init.credentials, android: /Android ([\d.]+)/.exec(ua)?.[1], chrome: /Chrome\/([\d.]+)/.exec(ua)?.[1] };
  const record = async (outcome: string, status?: number, response?: Response) => {
    if (!endpoint && !debug) return;
    let responseBody: string | undefined;
    let responseHeaders: Record<string, string> | undefined;
    if (debug && response) {
      responseHeaders = Object.fromEntries(response.headers.entries());
      if (typeof response.clone === 'function') {
        try { responseBody = await response.clone().text(); } catch { /* 诊断读取失败不影响业务响应。 */ }
      }
    }
    recordDiagnostic({ at: new Date().toISOString(), endpoint: endpoint ?? url, durationMs: Date.now() - started, status, outcome, ...metadata,
      ...(request ? { request } : {}), ...(debug && response ? { response: { status, headers: responseHeaders, ...(responseBody !== undefined ? { body: responseBody } : {}) } } : {}) });
  };
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const upstream = init.signal;
  const abort = () => controller.abort();
  if (upstream?.aborted) controller.abort();
  else upstream?.addEventListener('abort', abort, { once: true });
  try {
    const response = await transport(url, { ...init, signal: controller.signal });
    await record('response', response.status, response);
    const finalEndpoint = response.url ? diagnosticEndpoint(response.url) : undefined;
    if (finalEndpoint && finalEndpoint !== endpoint) void recordDiagnostic({ at: new Date().toISOString(), endpoint: finalEndpoint, outcome: 'auto-redirect', status: response.status });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    await record(timedOut ? 'timeout' : upstream?.aborted ? 'cancelled' : /cleartext/i.test(message) ? 'cleartext-blocked' : /ssl|tls|certificate/i.test(message) ? 'tls-failure' : 'transport-failure');
    throw error;
  }
  finally { clearTimeout(timeout); upstream?.removeEventListener('abort', abort); }
}
