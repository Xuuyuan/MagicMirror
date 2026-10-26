/** @jest-environment jsdom */
import { zhixueLoginScript } from '../providers/zhixue-login';

it('fills official login inputs after they appear without submitting or overwriting manual edits', () => {
  jest.useFakeTimers();
  window.history.replaceState({}, '', '/wap_login.html');
  try {
    window.eval(
      zhixueLoginScript('fictional-attempt', {
        login: 'fictional-account',
        password: 'fictional-password',
      }),
    );
    document.body.innerHTML =
      '<form><input placeholder="手机号/账号"><input type="password"><button type="submit">登录</button></form>';
    const submit = jest.fn((event: Event) => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', submit);
    const inputs = document.querySelectorAll('input');
    const changed = jest.fn();
    inputs[0].addEventListener('input', changed);
    jest.advanceTimersByTime(500);
    expect(inputs[0].value).toBe('fictional-account');
    expect(inputs[1].value).toBe('fictional-password');
    expect(changed).toHaveBeenCalledTimes(1);
    inputs[1].value = 'manual-correction';
    jest.advanceTimersByTime(1000);
    expect(inputs[1].value).toBe('manual-correction');
    expect(submit).not.toHaveBeenCalled();
  } finally {
    window.dispatchEvent(new Event('pagehide'));
    jest.useRealTimers();
    document.body.innerHTML = '';
  }
});
