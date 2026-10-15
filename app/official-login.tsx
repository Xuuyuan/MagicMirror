import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Button, Text } from 'react-native-paper';
import { WebView } from 'react-native-webview';
import { useAccounts } from '@/src/accounts-context';
import { ProviderError, type LocalAccount } from '@/src/domain/models';
import { beginWebLogin, isAllowedLoginUrl } from '@/src/services/web-login';
import { Screen, Header, LoadingState, backOrHome } from '@/src/ui';

type Attempt = Awaited<ReturnType<typeof beginWebLogin>>;
export default function OfficialLogin() {
  const { providerId, id, label } = useLocalSearchParams<{ providerId: string; id?: string; label?: string }>();
  const { reload, switchAccount } = useAccounts();
  const [attempt, setAttempt] = useState<Attempt>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<LocalAccount>();
  const [generation, setGeneration] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let current: Attempt | undefined;
    let cancelled = false;
    const controller = new AbortController();
    void beginWebLogin({ providerId, id, label: label ?? '' }, controller.signal).then((value) => {
      current = value;
      if (cancelled) value.cancel(); else setAttempt(value);
    }).catch(() => { if (!cancelled) setError('无法开始官方登录，请返回后重试'); });
    return () => { cancelled = true; mounted.current = false; controller.abort(); current?.cancel(); };
  }, [providerId, id, label, generation]);
  async function message(raw: string, url: string) {
    if (!attempt) return;
    setBusy(true);
    try {
      const account = await attempt.complete(raw, url);
      if (!account || !mounted.current) return;
      setCandidate(account);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof ProviderError ? failure.message : '登录验证失败，请重试');
    } finally { if (mounted.current) setBusy(false); }
  }
  async function save() {
    if (!attempt || busy) return;
    setBusy(true);
    setError('');
    try {
      const account = await attempt.commit();
      await reload();
      await switchAccount(account.id);
      router.replace('/');
    } catch (failure) {
      if (mounted.current) setError(failure instanceof ProviderError ? failure.message : '登录验证或安全存储失败，请重试');
    } finally { if (mounted.current) setBusy(false); }
  }
  return <Screen><Header title="官方网页登录" back /><View style={{ padding: 12, gap: 8 }}>
    <Text>请在官方页面输入账号密码，并手动完成滑块验证。登录后将自动验证当前学生，请核对后确认保存。</Text>
    {error ? <><Text accessibilityRole="alert">{error}</Text><Button disabled={busy} onPress={() => { attempt?.cancel(); setAttempt(undefined); setCandidate(undefined); setError(''); setGeneration((value) => value + 1); }}>重新打开登录页</Button></> : null}
    {candidate ? <><Text>请确认当前学生：{candidate.selectedProfile?.displayName}{candidate.selectedProfile?.schoolName ? ` · ${candidate.selectedProfile.schoolName}` : ''}</Text><Text>如需登录其他账号，请返回官方页面切换后重新验证。</Text><Button mode="contained" disabled={busy} loading={busy} onPress={() => { void save(); }}>确认保存此账号</Button></> : null}
    {busy ? <Text>正在验证或保存会话…</Text> : null}
    <Button disabled={busy} onPress={() => { attempt?.cancel(); backOrHome(); }}>取消登录</Button>
  </View>{attempt && !candidate ? <WebView key={generation} source={{ uri: attempt.url }} style={{ flex: 1 }}
    injectedJavaScript={attempt.script} javaScriptEnabled domStorageEnabled
    // Handle all navigation here instead of letting WebView open rejected
    // origins in an external browser (which could expose session URLs).
    originWhitelist={['*']}
    onShouldStartLoadWithRequest={(request) => isAllowedLoginUrl(request.url, attempt.allowedOrigins)}
    onMessage={(event) => { void message(event.nativeEvent.data, event.nativeEvent.url); }}
    onError={() => setError('官方页面加载失败，请检查网络后重试')}
    onHttpError={() => setError('官方页面暂时不可用，请重试')}
    setSupportMultipleWindows={false} mixedContentMode="never" allowFileAccess={false}
  /> : !error && !candidate ? <LoadingState label="正在准备官方登录…" /> : null}</Screen>;
}
