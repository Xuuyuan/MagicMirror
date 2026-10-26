/** Reads only the official current-student snapshot and report xToken.
 * No fetch interception, password access, CAPTCHA automation or credential logs.
 */
export function zhixueLoginScript(
  attemptId: string,
  credentials?: { login: string; password: string },
): string {
  return `(function () {
    if (window.top !== window) return true;
    var attempt = ${JSON.stringify(attemptId)};
    var key = 'magicmirror.zhixue.login.' + attempt;
    var sent = '';
    var openingReport = false;
    var credentials = ${JSON.stringify(credentials ?? null)};
    var filled = false;
    function fillCredentials() {
      if (!credentials || filled || location.pathname.indexOf('/wap_login') !== 0) return;
      var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
      var account = inputs.find(function (input) {
        return /account|username|user|login|手机号|账号/i.test((input.name || '') + ' ' + (input.id || '') + ' ' + (input.placeholder || ''));
      });
      var password = inputs.find(function (input) { return input.type === 'password'; });
      if (!account || !password) return;
      function setValue(input, value) {
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setValue(account, credentials.login);
      setValue(password, credentials.password);
      filled = true;
    }
    function inspect() {
      try {
        fillCredentials();
        var child = window.currentChild;
        if (location.pathname === '/container/container/parent/index/' && child && child.id && typeof child.name === 'string' && child.name.trim()) {
          sessionStorage.setItem(key, JSON.stringify({
            id: String(child.id), name: child.name,
            schoolName: child.school && typeof child.school.schoolName === 'string' ? child.school.schoolName : undefined
          }));
          // Keep the mobile UA. The official report app establishes its own
          // fresh token from the authenticated website session; no menu tap.
          if (!openingReport) {
            openingReport = true;
            location.replace('/activitystudy/web-report/index.html?from=web-container_top#/');
          }
          return;
        }
        // Report app clears its old token at startup. Never collect the token
        // from a container/login page where it might belong to an older login.
        if (location.pathname.indexOf('/activitystudy/web-report/') !== 0) return;
        var token = localStorage.getItem('xToken');
        var snapshot = sessionStorage.getItem(key);
        if (!token || !snapshot || sent === token || !window.ReactNativeWebView) return;
        sent = token;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          kind: 'official-session', attemptId: attempt,
          payload: { token: token, student: JSON.parse(snapshot) }
        }));
      } catch (_) { /* No private values in errors or logs. */ }
    }
    inspect();
    var timer = setInterval(inspect, 500);
    window.addEventListener('pagehide', function () { clearInterval(timer); });
    return true;
  })();`;
}
