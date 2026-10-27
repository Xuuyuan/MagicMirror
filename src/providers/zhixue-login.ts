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
    if (location.pathname === '/loginState/') {
      if (window.__magicmirrorPreparingLogin) return true;
      window.__magicmirrorPreparingLogin = true;
      document.body.textContent = '正在准备智学网登录，请稍候…';
      var stopped = false;
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 20000);
      window.addEventListener('pagehide', function () {
        stopped = true;
        controller.abort();
        clearTimeout(timer);
      });
      function logoutService(path) {
        return fetch(path, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'action=logout', signal: controller.signal
        }).then(function (response) {
          if (!response.ok || response.redirected) throw new Error('Official logout failed');
          return response.text();
        }).then(function (body) {
          if (body.trim() !== 'success') throw new Error('Official logout failed');
        });
      }
      logoutService('/ssoservice.jsp')
        .then(function () { return logoutService('/container/ssoservice.jsp'); })
        .then(function () {
          if (stopped) return;
          var loginUrl = 'https://www.zhixue.com/wap_login.html?nextpage=' +
            encodeURIComponent('https://www.zhixue.com/container/index');
          // CAS redirects through its official central logout, then back to
          // the login form. Never clear the device-wide WebView cookie jar.
          location.replace('https://sso.zhixue.com/sso_alpha/logout?service=' + encodeURIComponent(loginUrl));
        })
        .catch(function () {
          if (stopped) return;
          document.body.textContent = '无法准备智学网登录，请重新打开登录页';
          if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({
            kind: 'official-login-error', attemptId: attempt
          }));
        })
        .finally(function () { clearTimeout(timer); });
      return true;
    }
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
        var user = window.currentUser;
        var parentPage = location.pathname === '/container/container/parent/index/' && (!user || user.role === 'parent');
        var studentPage = location.pathname === '/container/container/student/index/' && user && user.role === 'student';
        var profile = studentPage ? user : parentPage ? child : null;
        if (profile && profile.id && typeof profile.name === 'string' && profile.name.trim()) {
          sessionStorage.setItem(key, JSON.stringify({
            student: {
              id: String(profile.id), name: profile.name,
              schoolName: !studentPage && child.school && typeof child.school.schoolName === 'string' ? child.school.schoolName : undefined
            },
            userType: studentPage ? 'STUDENT' : 'PARENT',
            accountId: user && user.id ? String(user.id) : undefined
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
          payload: Object.assign({ token: token }, JSON.parse(snapshot))
        }));
      } catch (_) { /* No private values in errors or logs. */ }
    }
    inspect();
    var timer = setInterval(inspect, 500);
    window.addEventListener('pagehide', function () { clearInterval(timer); });
    return true;
  })();`;
}
