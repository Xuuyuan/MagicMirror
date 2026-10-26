import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { ProviderError, type LocalAccount } from '../domain/models';
import { providerRegistry } from '../providers/registry';
import { accountStorage } from '../storage/accounts';
import { assertAccountSessionIdentity } from './accounts';
import { throwIfAborted } from './http';

const messageSchema = z.object({
  kind: z.literal('official-session'),
  attemptId: z.string(),
  payload: z.unknown(),
});
let activeAttempt: string | undefined;
export function isAllowedLoginUrl(value: string, origins: readonly string[]): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && !url.username && !url.password && origins.includes(url.origin)
    );
  } catch {
    return false;
  }
}

export async function beginWebLogin(
  input: {
    providerId: string;
    id?: string;
    label: string;
    credentials?: { login: string; password: string };
  },
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  if (activeAttempt) throw new ProviderError('RESTRICTED', '已有官方登录进行中，请先关闭该页面');
  const provider = providerRegistry.get(input.providerId);
  if (!provider?.webLogin) throw new ProviderError('UNSUPPORTED', '该平台不支持官方网页登录');
  const config = provider.webLogin;
  if (!isAllowedLoginUrl(config.url, config.allowedOrigins))
    throw new ProviderError('RESTRICTED', '官方登录地址无效');
  const attemptId = Crypto.randomUUID();
  activeAttempt = attemptId;
  let alive = true;
  const isActive = () => alive && activeAttempt === attemptId;
  const cancel = () => {
    alive = false;
    if (activeAttempt === attemptId) activeAttempt = undefined;
    signal?.removeEventListener('abort', cancel);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const previous = input.id ? await accountStorage.load(input.id) : null;
    if (!isActive()) throw new ProviderError('RESTRICTED', '登录已取消');
    if (input.id && (!previous || previous.providerId !== input.providerId))
      throw new ProviderError('RESTRICTED', '账号已删除或平台已变更');
    let handling = false;
    let candidate: LocalAccount | undefined;
    const requiresStudentReplacement = () =>
      !!candidate &&
      !!previous?.selectedProfile &&
      candidate.selectedProfile?.id !== previous.selectedProfile.id;
    return {
      url: config.url,
      allowedOrigins: config.allowedOrigins,
      script: config.script(attemptId, input.credentials),
      get previousProfile() {
        return previous?.selectedProfile;
      },
      get requiresStudentReplacement() {
        return requiresStudentReplacement();
      },
      cancel,
      async complete(raw: string, sourceUrl: string): Promise<LocalAccount | undefined> {
        if (
          !isActive() ||
          handling ||
          candidate ||
          !isAllowedLoginUrl(sourceUrl, config.allowedOrigins) ||
          raw.length > 65536
        )
          return undefined;
        let message;
        try {
          message = messageSchema.safeParse(JSON.parse(raw));
        } catch {
          return undefined;
        }
        if (!message.success || message.data.attemptId !== attemptId) return undefined;
        handling = true;
        try {
          const session = await config.authenticate(message.data.payload);
          if (session.providerId !== input.providerId)
            throw new ProviderError('RESTRICTED', '登录平台不匹配');
          if (previous) assertAccountSessionIdentity(previous, session);
          const profile = await provider.getProfile(session);
          const studentChanged =
            !!previous?.selectedProfile && previous.selectedProfile.id !== profile.id;
          // Empty exam lists are valid. Authentication must not require an exam.
          const account: LocalAccount = {
            id: previous?.id ?? Crypto.randomUUID(),
            revision: Crypto.randomUUID(),
            label: input.label.trim() || previous?.label || profile.displayName,
            login: input.credentials?.login.trim() || session.accountId,
            providerId: input.providerId,
            authMode: 'webview',
            session,
            password: input.credentials?.password || previous?.password,
            selectedProfile: profile,
            academicYear: studentChanged ? undefined : previous?.academicYear,
          };
          if (!isActive()) throw new ProviderError('RESTRICTED', '登录已取消');
          candidate = account;
          return account;
        } finally {
          handling = false;
        }
      },
      async commit(options?: { replaceStudent?: boolean }): Promise<LocalAccount> {
        if (!candidate || !isActive() || handling)
          throw new ProviderError('RESTRICTED', '请先完成官方登录验证');
        if (requiresStudentReplacement() && !options?.replaceStudent)
          throw new ProviderError('RESTRICTED', '学生已变化，请核对新旧学生并确认替换');
        handling = true;
        try {
          const confirmed = await provider.getProfile(candidate.session!);
          if (confirmed.id !== candidate.selectedProfile?.id)
            throw new ProviderError('RESTRICTED', '当前学生已变化，请重新登录验证');
          if (!(await accountStorage.saveAuthenticated(candidate, previous, isActive)))
            throw new ProviderError('RESTRICTED', '登录已取消或账号已变更，请重新登录');
          cancel();
          return candidate;
        } finally {
          handling = false;
        }
      },
    };
  } catch (error) {
    cancel();
    throw error;
  }
}
