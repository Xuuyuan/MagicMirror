import { useEffect, useState } from 'react';
import { Button } from 'react-native-paper';
import { router } from 'expo-router';
import { accountStorage } from './storage/accounts';
import { providerRegistry } from './providers/registry';

export function OfficialLoginButton({ accountId }: { accountId: string }) {
  const [target, setTarget] = useState<{ providerId: string; label: string; web: boolean }>();
  useEffect(() => {
    let alive = true;
    void accountStorage
      .load(accountId)
      .then((account) => {
        if (!alive || !account) return;
        const provider = providerRegistry.get(account.providerId);
        if (provider?.webLogin || provider?.getOfficialH5LoginEntry)
          setTarget({
            providerId: account.providerId,
            label: account.label,
            web: !!provider.webLogin,
          });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [accountId]);
  if (!target) return null;
  return (
    <Button
      mode="contained"
      onPress={() =>
        router.push(
          target.web
            ? {
                pathname: '/official-login' as never,
                params: { providerId: target.providerId, id: accountId, label: target.label },
              }
            : { pathname: '/haofenshu-webview', params: { accountId, mode: 'login' } },
        )
      }
    >
      使用官方网页登录
    </Button>
  );
}
