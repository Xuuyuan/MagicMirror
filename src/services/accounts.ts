import * as Crypto from 'expo-crypto';
import { ProviderError, type AuthSession, type LocalAccount } from '@/src/domain/models';
import { providerRegistry } from '@/src/providers/registry';
import { accountStorage } from '@/src/storage/accounts';
import { throwIfAborted } from '@/src/services/http';
const recovery = new Map<string, Promise<AuthSession>>();
export function invalidateAccountQueries(queryClient: { removeQueries: (filters: { queryKey: string[] }) => unknown }, accountId: string): void {
  queryClient.removeQueries({ queryKey: ['account', accountId] });
}
function loginRequired(account: LocalAccount): ProviderError {
  return account.authMode === 'token' || (!account.password && providerFor(account).authenticateWithToken)
    ? new ProviderError('SESSION_EXPIRED', 'Token 已失效，请编辑账号并输入新的 Token')
    : new ProviderError('INVALID_CREDENTIALS', '登录已失效，未保存可用凭据，请重新登录');
}
function providerFor(account: LocalAccount) { const provider = providerRegistry.get(account.providerId); if (!provider) throw new ProviderError('UNSUPPORTED', '该账号的平台不可用，请编辑账号'); return provider; }
async function restore(account: LocalAccount): Promise<AuthSession> { const identity = `${account.id}:${account.revision}`; const pending = recovery.get(identity); if (pending) return pending; const promise = (async () => { const provider = providerFor(account); let session: AuthSession | undefined; if (account.session && provider.refreshSession) { try { session = await provider.refreshSession(account.session); } catch (error) { if (!(error instanceof ProviderError) || error.code !== 'SESSION_EXPIRED') throw error; } } if (!session) { if (!account.password) throw loginRequired(account); session = await provider.authenticate(account.login, account.password); } if (session.providerId !== account.providerId) throw new ProviderError('UNKNOWN', '平台返回了不匹配的登录状态'); if (!await accountStorage.updateSession(account.id, account.revision, session)) throw new ProviderError('SESSION_EXPIRED', '账号配置已变更，请重新加载'); return session; })(); recovery.set(identity, promise); try { return await promise; } finally { recovery.delete(identity); } }
export async function withAccount<T>(id: string, operation: (provider: ReturnType<typeof providerFor>, session: AuthSession, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> { throwIfAborted(signal); const account = await accountStorage.load(id); if (!account) throw new ProviderError('NOT_FOUND', '账号已删除，请选择其他账号'); const provider = providerFor(account); if (!account.session || (account.session.expiresAt !== undefined && account.session.expiresAt <= Date.now())) return operation(provider, await restore(account), signal); try { return await operation(provider, account.session, signal); } catch (error) { throwIfAborted(signal); if (!(error instanceof ProviderError) || error.code !== 'SESSION_EXPIRED') throw error; const latest = await accountStorage.load(id); if (!latest || latest.revision !== account.revision) throw new ProviderError('SESSION_EXPIRED', '账号配置已变更，请重新加载'); if (latest.session?.accessToken === account.session.accessToken) { if (!await accountStorage.updateSession(id, latest.revision, { ...latest.session, expiresAt: 0 }, account.session.accessToken)) throw new ProviderError('SESSION_EXPIRED', '账号配置已变更，请重新加载'); } const recovered = latest.session && latest.session.accessToken !== account.session.accessToken ? latest.session : await restore(latest); return operation(provider, recovered, signal); } }
export async function authenticateAccount(input: { id?: string; label: string; providerId: string; login: string; password?: string; token?: string }): Promise<LocalAccount> {
  const previous = input.id ? await accountStorage.load(input.id) : null;
  const provider = providerRegistry.get(input.providerId);
  if (!provider) throw new ProviderError('UNSUPPORTED', '请选择可用平台');
  const tokenMode = input.token !== undefined;
  const login = input.login.trim();
  const password = tokenMode ? undefined : input.password || (previous?.providerId === input.providerId && previous.login === login ? previous.password : undefined);
  let session: AuthSession;
  if (tokenMode) {
    if (!provider.authenticateWithToken) throw new ProviderError('UNSUPPORTED', '该平台不支持 Token 登录');
    session = await provider.authenticateWithToken(input.token ?? '');
  } else {
    if (!password) throw new ProviderError('INVALID_CREDENTIALS', '请输入密码以重新登录');
    session = await provider.authenticate(login, password);
  }
  if (session.providerId !== input.providerId) throw new ProviderError('UNKNOWN', '平台返回了不匹配的登录状态');
  return { id: input.id ?? Crypto.randomUUID(), revision: Crypto.randomUUID(), label: input.label.trim() || login || session.accountId, providerId: input.providerId, login: login || session.accountId, authMode: tokenMode ? 'token' : 'password', password, session };
}
