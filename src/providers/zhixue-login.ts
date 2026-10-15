/** Reads only the official current-student snapshot and report xToken.
 * No fetch interception, password access, CAPTCHA automation or credential logs.
 */
export function zhixueLoginScript(attemptId: string): string {
  return `(function () {
    if (window.top !== window) return true;
    var attempt = ${JSON.stringify(attemptId)};
    var key = 'magicmirror.zhixue.login.' + attempt;
    var sent = '';
    var openingReport = false;
    function inspect() {
      try {
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
