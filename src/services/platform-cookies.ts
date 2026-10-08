type PlatformCookieContainer = { clearCookies?: (callback: (result: boolean) => void) => void };

/**
 * 清空系统 Cookie 容器。
 *
 * 部分平台（如百分智）的会话 Cookie 只能由系统容器保存，注销后必须清掉，否则会话会留在设备上。
 * react-native 仅在 App 运行时可用（Node 测试环境没有该模块），因此延迟获取并在不可用时静默跳过。
 */
export function clearPlatformCookies(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Networking } = require('react-native') as { Networking?: PlatformCookieContainer };
    if (!Networking?.clearCookies) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; resolve(); };
      Networking.clearCookies?.(finish);
      setTimeout(finish, 1500);
    });
  } catch { /* 运行环境没有原生 Cookie 容器。 */ return Promise.resolve(); }
}
