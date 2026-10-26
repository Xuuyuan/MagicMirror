import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Button, Text } from 'react-native-paper';
import { WebView } from 'react-native-webview';
import { useQueryClient } from '@tanstack/react-query';
import { useAccounts } from '@/src/accounts-context';
import { ProviderError, type LocalAccount } from '@/src/domain/models';
import { beginWebLogin, isAllowedLoginUrl } from '@/src/services/web-login';
import { takeWebLoginCredentials } from '@/src/services/web-login-draft';
import { invalidateAccountQueries } from '@/src/services/accounts';
import { Screen, Header, LoadingState, backOrHome } from '@/src/ui';

type Attempt = Awaited<ReturnType<typeof beginWebLogin>>;
export default function OfficialLogin() {
  const { providerId, id, label, draft } = useLocalSearchParams<{
    providerId: string;
    id?: string;
    label?: string;
    draft?: string;
  }>();
  const { reload, switchAccount } = useAccounts();
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState<Attempt>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<LocalAccount>();
  const [generation, setGeneration] = useState(0);
  const credentials = useRef<ReturnType<typeof takeWebLoginCredentials>>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let current: Attempt | undefined;
    let cancelled = false;
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => {
        if (cancelled) return;
        credentials.current ??= takeWebLoginCredentials(draft, providerId);
        if (!credentials.current)
          throw new ProviderError(
            'INVALID_CREDENTIALS',
            '登录信息已失效，请返回添加账号页重新输入账号密码',
          );
        return beginWebLogin(
          { providerId, id, label: label ?? '', credentials: credentials.current },
          controller.signal,
        );
      })
      .then((value) => {
        if (!value) return;
        current = value;
        if (cancelled) value.cancel();
        else setAttempt(value);
      })
      .catch((failure) => {
        if (!cancelled)
          setError(
            failure instanceof ProviderError ? failure.message : '无法开始官方登录，请返回后重试',
          );
      });
    return () => {
      cancelled = true;
      mounted.current = false;
      controller.abort();
      current?.cancel();
    };
  }, [draft, providerId, id, label, generation]);
  async function message(raw: string, url: string) {
    if (!attempt) return;
    setBusy(true);
    try {
      const account = await attempt.complete(raw, url);
      if (!account || !mounted.current) return;
      setCandidate(account);
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof ProviderError ? failure.message : '登录验证失败，请重试');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function save(replaceStudent = false) {
    if (!attempt || busy) return;
    setBusy(true);
    setError('');
    try {
      const account = await attempt.commit({ replaceStudent });
      invalidateAccountQueries(queryClient, account.id);
      await reload();
      await switchAccount(account.id);
      router.replace('/');
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof ProviderError ? failure.message : '登录验证或安全存储失败，请重试',
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Screen>
      <Header title="官方网页登录" back />
      <View style={{ padding: 12, gap: 8 }}>
        <Text>
          账号密码将自动填充到官方页面，请手动提交登录并完成验证。登录后请核对当前学生，再确认保存。
        </Text>
        {error ? (
          <>
            <Text accessibilityRole="alert">{error}</Text>
            <Button
              disabled={busy || !draft}
              onPress={() => {
                attempt?.cancel();
                setAttempt(undefined);
                setCandidate(undefined);
                setError('');
                setGeneration((value) => value + 1);
              }}
            >
              重新打开登录页
            </Button>
          </>
        ) : null}
        {candidate ? (
          <>
            {attempt?.requiresStudentReplacement ? (
              <>
                <Text variant="titleMedium">检测到学生变化</Text>
                <Text>
                  原学生：{attempt.previousProfile?.displayName}
                  {attempt.previousProfile?.schoolName
                    ? ` · ${attempt.previousProfile.schoolName}`
                    : ''}
                  {attempt.previousProfile?.grade ? ` · ${attempt.previousProfile.grade}` : ''}
                  {`（ID：${attempt.previousProfile?.id}）`}
                </Text>
                <Text>
                  新学生：{candidate.selectedProfile?.displayName}
                  {candidate.selectedProfile?.schoolName
                    ? ` · ${candidate.selectedProfile.schoolName}`
                    : ''}
                  {candidate.selectedProfile?.grade ? ` · ${candidate.selectedProfile.grade}` : ''}
                  {`（ID：${candidate.selectedProfile?.id}）`}
                </Text>
                <Text>确认后将替换此账号的学生，清除原学生的本地缓存并重置学年设置。</Text>
              </>
            ) : (
              <Text>
                请确认当前学生：{candidate.selectedProfile?.displayName}
                {candidate.selectedProfile?.schoolName
                  ? ` · ${candidate.selectedProfile.schoolName}`
                  : ''}
              </Text>
            )}
            <Button
              mode="contained"
              disabled={busy}
              loading={busy}
              onPress={() => {
                void save(attempt?.requiresStudentReplacement === true);
              }}
            >
              {attempt?.requiresStudentReplacement ? '确认替换学生并保存' : '确认保存此账号'}
            </Button>
          </>
        ) : null}
        {busy ? <Text>正在验证或保存会话…</Text> : null}
        <Button
          disabled={busy}
          onPress={() => {
            attempt?.cancel();
            backOrHome();
          }}
        >
          {candidate && attempt?.requiresStudentReplacement ? '取消替换，保留原学生' : '取消登录'}
        </Button>
      </View>
      {attempt && !candidate ? (
        <WebView
          key={generation}
          source={{ uri: attempt.url }}
          style={{ flex: 1 }}
          injectedJavaScript={attempt.script}
          javaScriptEnabled
          domStorageEnabled
          // Handle all navigation here instead of letting WebView open rejected
          // origins in an external browser (which could expose session URLs).
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(request) =>
            isAllowedLoginUrl(request.url, attempt.allowedOrigins)
          }
          onMessage={(event) => {
            void message(event.nativeEvent.data, event.nativeEvent.url);
          }}
          onError={() => setError('官方页面加载失败，请检查网络后重试')}
          onHttpError={() => setError('官方页面暂时不可用，请重试')}
          setSupportMultipleWindows={false}
          mixedContentMode="never"
          allowFileAccess={false}
        />
      ) : !error && !candidate ? (
        <LoadingState label="正在准备官方登录…" />
      ) : null}
    </Screen>
  );
}
