import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native-paper';
import { WebView } from 'react-native-webview';
import { useAccounts } from '@/src/accounts-context';
import { ProviderError } from '@/src/domain/models';
import { providerRegistry } from '@/src/providers/registry';
import { withAccount } from '@/src/services/accounts';
import { accountStorage } from '@/src/storage/accounts';
import { recordWebViewMessage } from '@/src/services/diagnostics';
import { useAppStore } from '@/src/state/app';
import { Screen, Header, Card, ErrorCard, LoadingState, backOrHome } from '@/src/ui';

// 官方 WebJsInterface/CommonJsInterface 暴露给 H5 的桥接方法名（反编译 com/yunxiao/hfs/h5/WebJsInterface.java）。
// 原型只实现数据类方法，其余用空实现兜底：页面直接调用未定义方法会抛 TypeError 并中断页面脚本。
const officialBridgeMethods = [
  'UMengEvent', 'UmengEventParams', 'adJump', 'aliPay', 'allowIndividuation', 'answerSheet', 'backPreviousPage', 'becomeSyVip', 'bindStudent', 'bossEvent',
  'checkAppIsInstall', 'classTravel', 'coinDetail', 'coinPay', 'commitPointsTask', 'createExportTask', 'downloadHomework', 'downloadImage', 'downloadTiKuPaper', 'downloadXDBX',
  'errorBook', 'export', 'exportErrorBook', 'feedDetailStat', 'feedLikeCount', 'feedLikeStat', 'finishPage', 'followFdWechat', 'followWechat', 'getRemainRight',
  'goBack', 'hideNavigationBar', 'improveScore', 'improveScorePlan', 'improveScoreReport', 'launchBrowser', 'launchMarket', 'leftButton', 'loadFinish', 'loadImage',
  'memberDetail', 'memberIntro', 'memberPay', 'myAssessment', 'myWallet', 'newMemberDetail', 'newMemberPay', 'onlineCustomer', 'onlineTutor', 'open',
  'openBar', 'personalInfo', 'prizeActivity', 'psychoAssessment', 'questionAnalysis', 'reLogin', 'redirectLogin', 'resultReport', 'rightButton', 'saveImage',
  'setShareBadgeUrl', 'setShareForecastScore', 'setTitle', 'setUserProfile', 'setting', 'shareContent', 'sharePage', 'shareRedPacket', 'showShare', 'simulationResult',
  'subjectAnalysis', 'targetChange', 'toService', 'toServiceWithId', 'toShare', 'turnFeedColumn', 'turnLiveCourse', 'turnMiniProgram', 'turnPeriod', 'updateDegradePopup',
  'updateUserInfo', 'upgradeFirst', 'upgradeFourth', 'upgradeSecond', 'upgradeThird', 'wakeQQ',
] as const;

function webViewScript(userInfo: Record<string, unknown>, cookie: string, debug: boolean, loginMode: boolean): string {
  const userInfoJson = JSON.stringify(userInfo).replace(/</g, '\\u003c');
  const cookieJson = JSON.stringify(cookie).replace(/</g, '\\u003c');
  const stubNamesJson = JSON.stringify(officialBridgeMethods);
  const debugJson = JSON.stringify(debug);
  return `(function() {
    var info = ${userInfoJson};
    var cookie = ${cookieJson};
    var debug = ${debugJson};
    var loginMode = ${JSON.stringify(loginMode)};
    function post(payload) {
      try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
    }
    function isLoginResponse(url) {
      try { var target = new URL(String(url), location.href); return target.origin === 'https://hfs-be.yunxiao.com' && target.pathname === '/v2/users/sessions'; } catch (e) { return false; }
    }
    function isExamDetailResponse(url) {
      try { var target = new URL(String(url), location.href); return target.origin === 'https://hfs-be.yunxiao.com' && /^\\/v[34]\\/exam\\//.test(target.pathname); } catch (e) { return false; }
    }
    function requestToken(headers) {
      try {
        if (!headers) return null;
        if (typeof headers.get === 'function') return headers.get('hfs-token') || headers.get('Hfs-Token');
        for (var key in headers) if (String(key).toLowerCase() === 'hfs-token') return String(headers[key]);
      } catch (e) {}
      return null;
    }
    function postSessionToken(url, status, body, token) {
      if (!loginMode || !isExamDetailResponse(url) || status !== 200 || !token) return;
      try { if (body && Number(body.code) === 0) post({ kind: 'login-token', token: token }); } catch (e) {}
    }
    // 页面真实 UA：用于与 Provider 伪造的 H5 UA 对照（服务端看到的是页面自己发出的 UA）。
    try { post({ kind: 'env', ua: navigator.userAgent }); } catch (e) {}
    window.HFS = window.HFS || {};
    ${stubNamesJson}.forEach(function(name) {
      if (typeof window.HFS[name] !== 'function') { window.HFS[name] = function() {}; }
    });
    window.HFS.getUserInfo = function() {
      var text = JSON.stringify(info);
      try {
        var parsed = JSON.parse(text);
        var student = parsed && parsed.linkedStudent ? parsed.linkedStudent : null;
        post({ kind: 'bridge', name: 'getUserInfo', hasLinkedStudent: !!student, isVirtual: student ? student.isVirtual : null, isVirtualType: student ? typeof student.isVirtual : 'none' });
      } catch (e) {}
      return text;
    };
    window.HFS.getCookie = function() { return cookie; };
    window.HFS.getSession = function() { return info.hfsToken || ''; };
    // 官方 getWebCookie 不回传值，而是异步回调页面侧的 HFS.setWebCookie({"isUserLogin":...})
    // （CommonJsInterface.java:1202-1215）；原样复刻，否则页面会一直等待登录态回调。
    window.HFS.getWebCookie = function() {
      setTimeout(function() {
        if (typeof window.HFS.setWebCookie === 'function') window.HFS.setWebCookie({ isUserLogin: true });
      }, 0);
    };
    // 页面自身发出的请求（uni.request 走 XHR）默认只上报摘要；调试模式额外保留完整请求与响应，供用户主动复制。
    if (!window.__hfsProbe) {
      window.__hfsProbe = true;
      function describe(u) {
        try {
          var target = new URL(String(u), location.href);
          if (target.hostname === 'hfs-be.yunxiao.com') {
            var routes = { '/v2/users/sessions': 'login', '/v2/users/shengya-token': 'shengya-token', '/v2/user-center/user-snapshot': 'profile', '/v2/config/school/hidden-config': 'hidden-config', '/v2/practices/weak-knowledges': 'weak-knowledges', '/v4/exam/archives': 'archives', '/v4/exam/home-page': 'home-page' };
            return 'https://hfs-be.yunxiao.com/' + (routes[target.pathname] || (/^\\/v[34]\\/exam\\//.test(target.pathname) ? 'exam-detail' : 'other' + target.pathname));
          }
          return target.hostname + target.pathname;
        } catch (e) { return 'invalid'; }
      }
      var origOpen = XMLHttpRequest.prototype.open, origSend = XMLHttpRequest.prototype.send;
      var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.open = function(m, u) { this.__hfsMethod = String(m || 'GET'); this.__hfsUrl = String(u || ''); this.__hfsHeaderNames = []; return origOpen.apply(this, arguments); };
      XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        try { this.__hfsHeaderNames.push(String(name).toLowerCase()); this.__hfsHeaders = this.__hfsHeaders || {}; this.__hfsHeaders[String(name)] = String(value); } catch (e) {}
        return origSetHeader.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        var xhr = this;
        xhr.addEventListener('loadend', function() {
          var code, risk = false;
          try {
            var parsed = JSON.parse(String(xhr.responseText || 'null'));
            if (parsed && typeof parsed === 'object') {
              if (typeof parsed.code === 'number' || typeof parsed.code === 'string') code = Number(parsed.code);
              risk = typeof parsed.msg === 'string' && /锁定|风险/.test(parsed.msg);
            }
          } catch (e) {}
          post({ kind: 'net', method: xhr.__hfsMethod || 'GET', endpoint: describe(xhr.__hfsUrl), status: xhr.status, code: code, risk: risk,
            headers: (xhr.__hfsHeaderNames || []).join(',') });
          if (debug) {
            var responseHeaders = {};
            try { (xhr.getAllResponseHeaders() || '').trim().split(/[\\r\\n]+/).forEach(function(line) { var parts = line.split(': '); if (parts.length > 1) responseHeaders[parts.shift()] = parts.join(': '); }); } catch (e) {}
            post({ kind: 'debug-net', endpoint: xhr.__hfsUrl || '', request: { url: xhr.__hfsUrl || '', method: xhr.__hfsMethod || 'GET', headers: xhr.__hfsHeaders || {}, body: body === undefined ? undefined : String(body) }, response: { status: xhr.status, headers: responseHeaders, body: String(xhr.responseText || '') } });
          }
          if (loginMode && isLoginResponse(xhr.__hfsUrl)) {
            try {
              var loginBody = JSON.parse(String(xhr.responseText || 'null'));
              var loginToken = loginBody && loginBody.data && typeof loginBody.data.token === 'string' ? loginBody.data.token : null;
              if (xhr.status === 200 && Number(loginBody.code) === 0 && loginToken) post({ kind: 'login-token', token: loginToken });
            } catch (e) {}
          }
          if (loginMode && isExamDetailResponse(xhr.__hfsUrl)) {
            try {
              var detailBody = JSON.parse(String(xhr.responseText || 'null'));
              var detailToken = requestToken(xhr.__hfsHeaders);
              postSessionToken(xhr.__hfsUrl, xhr.status, detailBody, detailToken);
            } catch (e) {}
          }
        });
        return origSend.apply(this, arguments);
      };
      if (window.fetch) {
        var origFetch = window.fetch;
        window.fetch = function(input, init) {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          return origFetch.apply(this, arguments).then(function(response) {
            post({ kind: 'net', method: (init && init.method) || 'GET', endpoint: describe(url), status: response.status, headers: '' });
            if (debug) response.clone().text().then(function(body) { var responseHeaders = {}; try { response.headers.forEach(function(value, name) { responseHeaders[name] = value; }); } catch (e) {} post({ kind: 'debug-net', endpoint: String(url), request: { url: String(url), method: (init && init.method) || 'GET', headers: (init && init.headers) || {}, body: init && init.body !== undefined ? String(init.body) : undefined }, response: { status: response.status, headers: responseHeaders, body: body } }); }).catch(function() {});
            if (loginMode && isLoginResponse(url) && response.status === 200) response.clone().json().then(function(body) { var loginToken = body && body.data && typeof body.data.token === 'string' ? body.data.token : null; if (body && Number(body.code) === 0 && loginToken) post({ kind: 'login-token', token: loginToken }); }).catch(function() {});
            if (loginMode && isExamDetailResponse(url) && response.status === 200) response.clone().json().then(function(body) { postSessionToken(url, response.status, body, requestToken(init && init.headers)); }).catch(function() {});
            return response;
          });
        };
      }
      window.addEventListener('error', function(e) { post({ kind: 'error', name: (e && e.error && e.error.name) || 'Error' }); });
      window.addEventListener('unhandledrejection', function() { post({ kind: 'error', name: 'UnhandledRejection' }); });
    }
  })(); true;`;
}

export default function HaofenshuWebView() {
  const { accountId, mode } = useLocalSearchParams<{ accountId?: string; mode?: string }>();
  const loginMode = mode === 'login';
  const debugMode = useAppStore((state) => state.debugMode);
  const { accounts } = useAccounts();
  const queryClient = useQueryClient();
  const account = accounts.find((item) => item.id === accountId);
  const [events, setEvents] = useState<string[]>([]);
  const handlingLoginToken = useRef(false);
  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    let message: { kind?: string; token?: unknown } | undefined;
    try { message = JSON.parse(event.nativeEvent.data) as { kind?: string; token?: unknown }; } catch { /* 探针消息统一交给记录器处理。 */ }
    if (loginMode && message?.kind === 'login-token' && typeof message.token === 'string' && account && !handlingLoginToken.current) {
      const token = message.token;
      handlingLoginToken.current = true;
      void (async () => {
        try {
          const provider = providerRegistry.get(account.providerId);
          if (!provider?.authenticateWithToken) throw new ProviderError('UNSUPPORTED', '该平台不支持官方网页登录会话');
          const session = await provider.authenticateWithToken(token);
          await provider.getExamList(session);
          if (!await accountStorage.updateSession(account.id, account.revision, session)) throw new ProviderError('SESSION_EXPIRED', '账号配置已变更，请重新加载');
          await queryClient.invalidateQueries({ queryKey: ['account', account.id, account.revision, 'exams'] });
          backOrHome();
        } catch (error) {
          handlingLoginToken.current = false;
          const summary = error instanceof ProviderError ? error.message : '官方网页登录会话验证失败';
          setEvents((previous) => [...previous.slice(-19), summary]);
        }
      })();
      return;
    }
    const summary = recordWebViewMessage(event.nativeEvent.data);
    if (summary) setEvents((previous) => [...previous.slice(-19), summary]);
  }, [loginMode, account, queryClient]);
  // 对照实验模式：只加载官方 H5 登录页，由页面自行登录并创建会话，Provider 不参与任何凭据传递。
  const loginEntry = useMemo(() => loginMode && account ? providerRegistry.get(account.providerId)?.getOfficialH5LoginEntry?.() : undefined, [loginMode, account]);
  const query = useQuery({
    queryKey: ['account', accountId, account?.revision, 'official-h5-bootstrap'],
    enabled: !!accountId && !!account && !loginMode,
    queryFn: ({ signal }) => withAccount(accountId!, async (provider, session, requestSignal) => {
      if (!provider.getOfficialH5Bootstrap) throw new ProviderError('UNSUPPORTED', '该平台没有官方 H5 诊断入口');
      if (signal.aborted || requestSignal?.aborted) throw new ProviderError('NETWORK', '请求已取消');
      return provider.getOfficialH5Bootstrap(session);
    }, signal),
  });
  const bootstrap = useMemo(() => loginMode
    ? loginEntry ? { url: loginEntry.url, userAgentSuffix: loginEntry.userAgentSuffix, cookie: '', userInfo: {} } : undefined
    : query.data, [loginEntry, loginMode, query.data]);
  const script = useMemo(() => bootstrap ? webViewScript(bootstrap.userInfo, bootstrap.cookie, debugMode && !loginMode, loginMode) : '', [bootstrap, debugMode, loginMode]);
  if (!account) return <Screen><Header title="官方页面诊断" back /><Card><Text>账号不存在或已删除。</Text></Card></Screen>;
  if (loginMode && !loginEntry) return <Screen><Header title="官方页面诊断" back /><Card><Text>该平台没有官方 H5 登录入口。</Text></Card></Screen>;
  if (!loginMode && query.isPending) return <Screen><Header title="官方页面诊断" back /><LoadingState label="正在准备官方 H5 会话…" /></Screen>;
  if (!loginMode && (query.error || !query.data)) return <Screen><Header title="官方页面诊断" back /><ErrorCard error={query.error} retry={() => void query.refetch()} accountId={account.id} /></Screen>;
  if (!bootstrap) return <Screen><Header title="官方页面诊断" back /><Card><Text>启动参数不可用。</Text></Card></Screen>;
  return <Screen><Header title={loginMode ? '官方网页登录' : '官方考试档案'} back />{loginMode ? <Text style={{ paddingHorizontal: 12, paddingVertical: 8 }}>请在官方页面登录当前账号。考试列表验证成功后会自动保存会话并关闭页面。</Text> : null}<WebView
    source={bootstrap.cookie ? { uri: bootstrap.url, headers: { Cookie: bootstrap.cookie } } : { uri: bootstrap.url }}
    applicationNameForUserAgent={bootstrap.userAgentSuffix}
    injectedJavaScriptBeforeContentLoaded={script}
    injectedJavaScript={script}
    onMessage={onMessage}
    javaScriptEnabled
    domStorageEnabled
    sharedCookiesEnabled
    thirdPartyCookiesEnabled
    setSupportMultipleWindows={false}
    originWhitelist={['https://*', 'http://*']}
    onNavigationStateChange={(state) => { if (!state.url.startsWith('https://mobile.haofenshu.com/')) backOrHome(); }}
    style={{ flex: 1 }}
  />
  <View style={{ borderTopWidth: 1, borderTopColor: '#8884', paddingHorizontal: 12, paddingVertical: 6, maxHeight: 120 }}>
    <ScrollView><Text variant="labelSmall">{events.length ? events.join('\n') : '等待页面探针…（打开页面后此处显示桥接调用与页面请求）'}</Text></ScrollView>
  </View>
</Screen>;
}
