import { useEffect, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import { Button, Menu, Text, TextInput } from 'react-native-paper';
import { ProviderError } from '@/src/domain/models';
import { useAccounts } from '@/src/accounts-context';
import { accountStorage } from '@/src/storage/accounts';
import { authenticateAccount } from '@/src/services/accounts';
import { prepareWebLoginCredentials } from '@/src/services/web-login-draft';
import { providerRegistry } from '@/src/providers/registry';
import type { ScoreProviderMetadata } from '@/src/providers/types';
import { Screen, Header, Body, Card, LoadingState, backOrHome } from '@/src/ui';

function providerSelectionName(metadata: ScoreProviderMetadata) {
  return metadata.remark ? `${metadata.name}（${metadata.remark}）` : metadata.name;
}

export default function AccountEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { saveAccount } = useAccounts();
  // 菜单与锚点按钮同宽（Body 16 + Card 内容边距 16，左右各 32），才能完整盖住下方的 Token 按钮。
  const { width: screenWidth } = useWindowDimensions();
  const [label, setLabel] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [tokenMode, setTokenMode] = useState(false);
  const [providerId, setProviderId] = useState('haofenshu-parent');
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [providerMenu, setProviderMenu] = useState(false);
  const [savedPasswordIdentity, setSavedPasswordIdentity] = useState<{
    providerId: string;
    login: string;
  }>();
  const [replacingPassword, setReplacingPassword] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loginMethod, setLoginMethod] = useState<string>();
  const selectedProvider = providerRegistry.get(providerId);
  const providerName = selectedProvider
    ? providerSelectionName(selectedProvider.metadata)
    : providerId;
  const tokenSupported = providerRegistry.get(providerId)?.authenticateWithToken !== undefined;
  const canReusePassword =
    !!savedPasswordIdentity &&
    savedPasswordIdentity.providerId === providerId &&
    savedPasswordIdentity.login === login.trim();
  const showPasswordInput = !canReusePassword || replacingPassword;
  const identityChanged = !!id && !!savedPasswordIdentity && !canReusePassword;
  const canSubmit =
    !loading &&
    !busy &&
    (tokenMode ? !!token.trim() : !!login.trim() && (!showPasswordInput || !!password.length));
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void accountStorage
      .load(id)
      .then((account) => {
        if (!alive || !account) return;
        setLabel(account.label);
        setLogin(account.login);
        setLoginMethod(account.loginMethod);
        setProviderId(account.providerId);
        setSavedPasswordIdentity(
          account.password ? { providerId: account.providerId, login: account.login } : undefined,
        );
        setTokenMode(
          account.authMode === 'token' ||
            (!account.password &&
              !!providerRegistry.get(account.providerId)?.authenticateWithToken),
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  function resetPasswordInput() {
    setPassword('');
    setPasswordVisible(false);
    setReplacingPassword(false);
    setError('');
  }
  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      if (selectedProvider?.webLogin) {
        const previous = canReusePassword && id ? await accountStorage.load(id) : null;
        const currentPassword = password || previous?.password;
        if (!currentPassword) throw new ProviderError('INVALID_CREDENTIALS', '请输入密码');
        const draft = prepareWebLoginCredentials(providerId, {
          login: login.trim(),
          password: currentPassword,
        });
        router.push({
          pathname: '/official-login' as never,
          params: { providerId, ...(id ? { id } : {}), label, draft },
        });
        return;
      }
      let account;
      try {
        account = await authenticateAccount({
          id,
          label,
          login,
          providerId,
          password,
          loginMethod: loginMethod ?? selectedProvider?.passwordLoginMethods?.[0]?.id,
          token: tokenMode ? token : undefined,
        });
      } catch (failure) {
        setError(
          failure instanceof ProviderError ? failure.message : '登录未完成，请检查网络后重试',
        );
        return;
      }
      try {
        await saveAccount(account);
      } catch {
        setError('登录成功，但设备安全存储失败，请稍后重试');
        return;
      }
      backOrHome();
    } catch (failure) {
      setError(failure instanceof ProviderError ? failure.message : '无法开始登录，请重试');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Header title={id ? '编辑账号' : '添加账号'} back />
      <Body>
        {loading ? (
          <LoadingState label="正在读取账号…" />
        ) : (
          <Card>
            <Text variant="titleMedium">阅卷平台</Text>
            <Menu
              visible={providerMenu}
              onDismiss={() => setProviderMenu(false)}
              statusBarHeight={0}
              anchorPosition="bottom"
              contentStyle={{ width: screenWidth - 64 }}
              anchor={
                <Button
                  mode="outlined"
                  icon="chevron-down"
                  disabled={busy}
                  onPress={() => setProviderMenu(true)}
                  style={{ width: '100%' }}
                  contentStyle={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}
                >
                  {providerName}
                </Button>
              }
            >
              {providerRegistry.list().map((provider) => (
                <Menu.Item
                  key={provider.metadata.id}
                  leadingIcon={provider.metadata.id === providerId ? 'check' : undefined}
                  title={providerSelectionName(provider.metadata)}
                  disabled={busy}
                  onPress={() => {
                    if (provider.metadata.id !== providerId) {
                      resetPasswordInput();
                      setLoginMethod(undefined);
                    }
                    setProviderId(provider.metadata.id);
                    setTokenMode(false);
                    setProviderMenu(false);
                  }}
                />
              ))}
            </Menu>
            <>
              {!tokenMode && selectedProvider?.passwordLoginMethods && (
                <View style={{ gap: 8 }}>
                  <Text variant="titleMedium">登录方式</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {selectedProvider.passwordLoginMethods.map((method) => {
                      const selected =
                        method.id ===
                        (loginMethod ?? selectedProvider.passwordLoginMethods?.[0]?.id);
                      return (
                        <Button
                          key={method.id}
                          mode={selected ? 'contained-tonal' : 'outlined'}
                          accessibilityState={{ selected }}
                          disabled={busy}
                          onPress={() => {
                            setLoginMethod(method.id);
                            setError('');
                          }}
                          style={{ flex: 1 }}
                        >
                          {method.label}
                        </Button>
                      );
                    })}
                  </View>
                </View>
              )}
              {tokenSupported && (
                <Button
                  compact
                  disabled={busy}
                  onPress={() => {
                    resetPasswordInput();
                    setTokenMode(!tokenMode);
                  }}
                >
                  {tokenMode ? '改用账号密码登录' : '使用 Token 登录'}
                </Button>
              )}
              <TextInput
                mode="outlined"
                label="账号备注"
                value={label}
                onChangeText={setLabel}
                disabled={busy}
              />
              <TextInput
                mode="outlined"
                label={tokenMode ? '账号标识（可选）' : '登录账号'}
                value={login}
                onChangeText={(value) => {
                  if (value.trim() !== login.trim()) resetPasswordInput();
                  setLogin(value);
                }}
                autoCapitalize="none"
                disabled={busy}
              />
              {tokenMode ? (
                <TextInput
                  mode="outlined"
                  label="好分数 Token"
                  value={token}
                  onChangeText={setToken}
                  autoCapitalize="none"
                  secureTextEntry
                  disabled={busy}
                />
              ) : showPasswordInput ? (
                <View style={{ gap: 4 }}>
                  <TextInput
                    mode="outlined"
                    label="密码"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!passwordVisible}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus={replacingPassword}
                    returnKeyType="done"
                    onSubmitEditing={() => void submit()}
                    disabled={busy}
                    right={
                      <TextInput.Icon
                        icon={passwordVisible ? 'eye-off' : 'eye'}
                        accessibilityLabel={passwordVisible ? '隐藏密码' : '显示密码'}
                        disabled={busy}
                        onPress={() => setPasswordVisible(!passwordVisible)}
                      />
                    }
                  />
                  {identityChanged ? (
                    <Text variant="bodySmall">账号已变更，请重新输入密码</Text>
                  ) : id ? (
                    <Text variant="bodySmall">请输入该平台账号的密码</Text>
                  ) : null}
                  {canReusePassword && replacingPassword && (
                    <Button
                      compact
                      disabled={busy}
                      style={{ alignSelf: 'flex-end' }}
                      onPress={resetPasswordInput}
                    >
                      取消替换
                    </Button>
                  )}
                </View>
              ) : (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text>密码已保存</Text>
                  <Button
                    compact
                    disabled={busy}
                    onPress={() => {
                      setPasswordVisible(false);
                      setReplacingPassword(true);
                    }}
                  >
                    替换密码
                  </Button>
                </View>
              )}
              <Text>
                {selectedProvider?.webLogin
                  ? '账号密码用于自动填充官方登录页面，由你手动提交登录并完成验证。确认保存账号后，凭据保存在设备安全存储中。'
                  : tokenMode
                    ? 'Token 保存在设备安全存储中，失效后需手动更新。请输入官方请求头 hfs-token 或 Cookie 中 hfs-session-id 的值。'
                    : '登录凭据保存在设备安全存储中，用于登录失效后自动重新登录。'}
              </Text>
              {error ? <Text accessibilityRole="alert">{error}</Text> : null}
              <Button
                mode="contained"
                loading={busy}
                disabled={!canSubmit}
                onPress={() => void submit()}
              >
                {selectedProvider?.webLogin ? '官方网页登录' : '登录并保存'}
              </Button>
            </>
          </Card>
        )}
      </Body>
    </Screen>
  );
}
