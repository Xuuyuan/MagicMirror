import { createRuiyaProvider } from './ruiya';

/** 百分智与睿芽共用官方报告查询协议，但会话和 Provider 身份保持独立。 */
export const bfzksProvider = createRuiyaProvider(undefined, {
  host: 'https://www.bfzks.com',
  providerId: 'bfzks',
  platformLabel: '百分智',
  // 百分智账号使用官网的“报告查询”类型。
  system: '1',
  allowedHosts: ['xueqingroom.cn'],
  // 登录会跳转到 bfzks.xueqingroom.cn，会话 Cookie 由中间 302 下发，必须由系统 Cookie 容器承接。
  platformCookieJar: true,
  extendedReports: true,
  abilityScoreAction: 'getByAbilityScore',
});
