import { clearDiagnostics, diagnosticSnapshot, recordDiagnostic, recordWebViewMessage, setDiagnosticDebugMode } from '@/src/services/diagnostics';

describe('debug diagnostics', () => {
  beforeEach(() => { clearDiagnostics(); setDiagnosticDebugMode(false); });
  afterAll(() => { clearDiagnostics(); setDiagnosticDebugMode(false); });

  it('does not retain events before debug mode is enabled', () => {
    recordDiagnostic({ at: 'now', endpoint: 'test', outcome: 'response', detail: 'secret' });
    expect(diagnosticSnapshot()).toEqual([]);
  });

  it('retains complete native request and response fields in debug mode', () => {
    setDiagnosticDebugMode(true);
    recordDiagnostic({ at: 'now', endpoint: 'https://example.invalid/login', outcome: 'response', request: { url: 'https://example.invalid/login', method: 'POST', headers: { Authorization: 'secret' }, body: '{"password":"secret"}' }, response: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"token":"secret"}' } });
    expect(diagnosticSnapshot()[0]).toMatchObject({ request: { headers: { Authorization: 'secret' }, body: '{"password":"secret"}' }, response: { body: '{"token":"secret"}' } });
  });

  it('accepts complete WebView request and response payloads only in debug mode', () => {
    setDiagnosticDebugMode(true);
    expect(recordWebViewMessage(JSON.stringify({ kind: 'debug-net', endpoint: 'https://example.invalid/data', request: { url: 'https://example.invalid/data', method: 'POST', headers: { Cookie: 'secret' }, body: 'password=secret' }, response: { status: 200, headers: {}, body: '{"ok":true}' } }))).toContain('POST');
    expect(diagnosticSnapshot()[0]).toMatchObject({ request: { body: 'password=secret' }, response: { body: '{"ok":true}' } });
  });
});
