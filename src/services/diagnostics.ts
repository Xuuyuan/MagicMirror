type Diagnostic = { at: string; endpoint: string; durationMs?: number; status?: number; outcome: string; code?: number; credentials?: string; android?: string; chrome?: string; source?: 'provider' | 'webview'; detail?: string; request?: { url: string; method: string; headers: Record<string, string>; body?: string }; response?: { status?: number; headers?: Record<string, string>; body?: string } };
const events: Diagnostic[] = [];
let debugMode = false;
export function setDiagnosticDebugMode(enabled: boolean): void { debugMode = enabled; }
export function debugModeEnabled(): boolean { return debugMode; }
export function diagnosticEndpoint(url: string): string | undefined {
  try {
    const target = new URL(url);
    if (target.hostname === 'hfs-be.yunxiao.com') {
      const routes: Record<string, string> = { '/v2/users/sessions': 'login', '/v2/user-center/user-snapshot': 'profile', '/v4/exam/archives': 'archives', '/v4/exam/home-page': 'home-page' };
      const route = routes[target.pathname] ?? (/^\/v[34]\/exam\//.test(target.pathname) ? 'exam-detail' : undefined);
      return route ? `hfs/${route}` : undefined;
    }
    if (target.hostname === 'www.bfzks.com' || target.hostname === 'bfzks.xueqingroom.cn') {
      const route = target.pathname === '/' ? 'login-page' : target.pathname === '/Login.aspx' ? 'login-redirect' : target.pathname === '/report/test/' ? 'report-list' : target.pathname.startsWith('/report/singleGroup') ? 'report-detail' : target.pathname.startsWith('/api/') ? 'report-api' : 'other';
      return `${target.protocol}//${target.hostname}/${route}`;
    }
  } catch { /* URL 不合法时不记录。 */ }
  return undefined;
}
export function recordDiagnostic(event: Diagnostic): void {
  if (!debugModeEnabled()) return;
  events.push(event);
}

/** 未列入白名单的页面请求：保留主机与路径（不含查询串），便于确认被风控命中的具体端点。 */
function describeNetUrl(url: string): string {
  try {
    const target = new URL(url);
    return `net/${target.hostname}${target.pathname}`;
  } catch { return 'net/other'; }
}
export function diagnosticSnapshot(): Diagnostic[] { return events.map((event) => ({ ...event })); }
export function clearDiagnostics(): void { events.length = 0; }

/**
 * 记录官方 H5 页面（WebView 内）上报的探针事件，返回一行可直接展示的摘要。
 * 只接收注入脚本约定的字段（桥接调用、请求路径与状态码、错误类型名），其余一律丢弃。
 */
export function recordWebViewMessage(raw: string): string | undefined {
  let message: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    message = parsed as Record<string, unknown>;
  } catch { return undefined; }
  const kind = message.kind;
  const at = new Date().toISOString();
  if (kind === 'debug-net' && typeof message.endpoint === 'string') {
    const request = typeof message.request === 'object' && message.request !== null ? message.request as Record<string, unknown> : {};
    const response = typeof message.response === 'object' && message.response !== null ? message.response as Record<string, unknown> : {};
    const headers = typeof request.headers === 'object' && request.headers !== null ? request.headers as Record<string, string> : {};
    const responseHeaders = typeof response.headers === 'object' && response.headers !== null ? response.headers as Record<string, string> : {};
    recordDiagnostic({ at, source: 'webview', endpoint: message.endpoint, outcome: 'debug-response', status: typeof response.status === 'number' ? response.status : undefined,
      request: { url: String(request.url ?? message.endpoint), method: String(request.method ?? 'GET'), headers, ...(request.body !== undefined ? { body: String(request.body) } : {}) },
      response: { status: typeof response.status === 'number' ? response.status : undefined, headers: responseHeaders, ...(response.body !== undefined ? { body: String(response.body) } : {}) } });
    return `调试请求 ${String(request.method ?? 'GET')} ${String(request.url ?? message.endpoint)}`;
  }
  if (kind === 'bridge' && typeof message.name === 'string') {
    const linked = message.hasLinkedStudent === true ? 'yes' : 'no';
    const isVirtual = message.isVirtual === undefined || message.isVirtual === null ? 'none' : `${String(message.isVirtual)}(${String(message.isVirtualType)})`;
    const detail = `linked=${linked} isVirtual=${isVirtual}`;
    recordDiagnostic({ at, source: 'webview', endpoint: `webview/${message.name}`, outcome: 'bridge', detail });
    return `webview/${message.name} ${detail}`;
  }
  if (kind === 'env' && typeof message.ua === 'string') {
    const ua = message.ua.slice(0, 200);
    recordDiagnostic({ at, source: 'webview', endpoint: 'webview/env', outcome: 'env', detail: ua });
    return `页面 UA: ${ua}`;
  }
  if (kind === 'net' && typeof message.endpoint === 'string') {
    const label = message.endpoint.startsWith('http') ? diagnosticEndpoint(message.endpoint) ?? describeNetUrl(message.endpoint) : describeNetUrl(message.endpoint);
    const status = typeof message.status === 'number' ? message.status : undefined;
    const code = typeof message.code === 'number' ? message.code : undefined;
    const risk = message.risk === true;
    const headers = typeof message.headers === 'string' && message.headers ? message.headers.slice(0, 200) : undefined;
    const summary = `${message.method ?? 'GET'} ${label} status=${status ?? '?'}${code !== undefined ? ` code=${code}` : ''}${risk ? ' 风控' : ''}`;
    recordDiagnostic({ at, source: 'webview', endpoint: label, outcome: risk ? 'risk-rejected' : status !== undefined && status >= 200 && status < 300 ? 'http-ok' : 'http-fail', status, code, detail: headers ? `${summary} [头名: ${headers}]` : summary });
    return summary;
  }
  if (kind === 'error' && typeof message.name === 'string') {
    recordDiagnostic({ at, source: 'webview', endpoint: 'webview/page-error', outcome: 'page-error', detail: message.name });
    return `页面错误 ${message.name}`;
  }
  return undefined;
}
