import { useEffect, useState } from 'react';
import { Button, Text } from 'react-native-paper';
import { router } from 'expo-router';
import { accountStorage } from './storage/accounts';
import { providerRegistry } from './providers/registry';
import { prepareWebLoginCredentials } from './services/web-login-draft';

export function OfficialLoginButton({
  accountId,
  fallbackToEdit = false,
}: {
  accountId: string;
  fallbackToEdit?: boolean;
}) {
  const [target, setTarget] = useState<{
    accountId: string;
    action: 'web' | 'h5' | 'edit';
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void accountStorage
      .load(accountId)
      .then((account) => {
        if (!alive || !account) return;
        const provider = providerRegistry.get(account.providerId);
        setTarget({
          accountId,
          action:
            provider?.webLogin && account.login && account.password
              ? 'web'
              : !provider?.webLogin && provider?.getOfficialH5LoginEntry
                ? 'h5'
                : 'edit',
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [accountId]);
  if (target?.accountId !== accountId || (target.action === 'edit' && !fallbackToEdit)) return null;
  const action = target.action;
  async function login() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const account = await accountStorage.load(accountId);
      if (!account) {
        setError('账号已删除，请选择其他账号');
        return;
      }
      const provider = providerRegistry.get(account.providerId);
      if (action === 'web' && provider?.webLogin && account.login && account.password) {
        const draft = prepareWebLoginCredentials(account.providerId, {
          login: account.login,
          password: account.password,
        });
        router.push({
          pathname: '/official-login' as never,
          params: { providerId: account.providerId, id: accountId, label: account.label, draft },
        });
      } else if (action === 'h5' && !provider?.webLogin && provider?.getOfficialH5LoginEntry) {
        router.push({ pathname: '/haofenshu-webview', params: { accountId, mode: 'login' } });
      } else {
        router.push({ pathname: '/account-edit', params: { id: accountId } });
      }
    } catch {
      setError('无法开始登录，请重试');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button mode="contained" disabled={busy} loading={busy} onPress={() => void login()}>
        {action === 'web'
          ? '使用官方网页登录'
          : action === 'h5'
            ? '使用官方网页登录'
            : '重新登录 / 编辑账号'}
      </Button>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </>
  );
}
