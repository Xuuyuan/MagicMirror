import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Divider,
  Portal,
  ProgressBar,
  Text,
  useTheme,
} from 'react-native-paper';
import Markdown from 'react-native-markdown-display';
import {
  checkForUpdate,
  downloadUpdate,
  getCurrentVersion,
  getInstallerUri,
  shouldPromptForRelease,
  type UpdateReleaseNotes,
  type UpdateRelease,
} from '@/src/services/updates';

const STORAGE_KEY = 'magicmirror.update.v1';
const UNKNOWN_SOURCES_ACTION = 'android.settings.MANAGE_UNKNOWN_APP_SOURCES';
// Dialog.Actions 给直接子元素注入 compact，把按钮压成 auto 最小宽度；恢复库默认的 64 使“下载”和“安装”等宽。
const ACTION_MIN_WIDTH = 64;
// 更新日志可能很长，限制高度让弹窗高度稳定，内容在框内滚动。
const NOTES_MAX_HEIGHT = 140;
type UpdateState = { ignoredVersion?: string };
type UpdateContextValue = { checking: boolean; checkForUpdates: () => Promise<void> };
const UpdateContext = createContext<UpdateContextValue | null>(null);

function ReleaseNotes({ notes }: { notes: string }) {
  const theme = useTheme();
  return (
    <Markdown style={{ body: { color: theme.colors.onSurface, fontSize: 14 } }}>{notes}</Markdown>
  );
}

async function loadState(): Promise<UpdateState> {
  try {
    const SecureStore = await import('expo-secure-store');
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : {};
    return typeof value === 'object' && value !== null ? (value as UpdateState) : {};
  } catch {
    return {};
  }
}

async function saveState(state: UpdateState): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(state));
}

async function checkWithFallback() {
  try {
    return await checkForUpdate();
  } catch (mirrorError) {
    try {
      return await checkForUpdate(getCurrentVersion(), '');
    } catch {
      throw mirrorError;
    }
  }
}

export function useUpdates(): UpdateContextValue {
  const value = useContext(UpdateContext);
  if (!value) throw new Error('useUpdates must be used inside UpdateProvider');
  return value;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(false);
  const [release, setRelease] = useState<UpdateRelease>();
  const [currentRelease, setCurrentRelease] = useState<UpdateReleaseNotes>();
  const [currentVersion, setCurrentVersion] = useState(getCurrentVersion());
  const [latestVersion, setLatestVersion] = useState<string>();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const [downloadedUri, setDownloadedUri] = useState<string>();
  const running = useRef(false);

  const checkForUpdates = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setChecking(true);
    setError(undefined);
    setLatestVersion(undefined);
    try {
      const result = await checkWithFallback();
      setCurrentVersion(result.currentVersion);
      setCurrentRelease(result.currentRelease);
      if (!result.release) {
        setRelease(undefined);
        setLatestVersion(result.currentVersion);
        setVisible(true);
        return;
      }
      const state = await loadState();
      if (!shouldPromptForRelease(result.release.version, state.ignoredVersion, true)) return;
      setLatestVersion(undefined);
      setRelease(result.release);
      setVisible(true);
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : '检查更新失败，请稍后重试。');
      setVisible(true);
    } finally {
      setChecking(false);
      running.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    running.current = true;
    void (async () => {
      try {
        const result = await checkWithFallback();
        if (!active || !result.release) return;
        const state = await loadState();
        if (shouldPromptForRelease(result.release.version, state.ignoredVersion)) {
          setCurrentVersion(result.currentVersion);
          setRelease(result.release);
          setVisible(true);
        }
      } catch {
        /* 自动检查失败不打断应用启动，设置页可手动重试。 */
      } finally {
        running.current = false;
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function ignoreVersion() {
    if (!release) return;
    await saveState({ ignoredVersion: release.version });
    setVisible(false);
    setRelease(undefined);
    setCurrentRelease(undefined);
    setLatestVersion(undefined);
    setError(undefined);
  }

  async function install() {
    if (!downloadedUri) return;
    if (Platform.OS !== 'android') {
      setError('当前版本只支持 Android 安装更新。');
      return;
    }
    try {
      const IntentLauncher = await import('expo-intent-launcher');
      const contentUri = await getInstallerUri(downloadedUri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: 'application/vnd.android.package-archive',
        flags: 1,
      });
    } catch {
      setError('系统未允许安装此应用，请打开安装权限后重试。');
    }
  }

  async function openInstallSettings() {
    if (Platform.OS !== 'android') return;
    try {
      const IntentLauncher = await import('expo-intent-launcher');
      await IntentLauncher.startActivityAsync(UNKNOWN_SOURCES_ACTION, {
        data: 'package:com.magicmirror.app',
      });
    } catch {
      await Linking.openSettings();
    }
  }

  async function download() {
    if (!release || (progress !== undefined && progress < 1)) return;
    setError(undefined);
    setProgress(0);
    setDownloadedUri(undefined);
    try {
      let uri: string;
      try {
        uri = await downloadUpdate(release, setProgress);
      } catch (mirrorError) {
        try {
          uri = await downloadUpdate(release, setProgress, '');
        } catch {
          throw mirrorError;
        }
      }
      setDownloadedUri(uri);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '下载更新失败，请重试。');
      setProgress(undefined);
    }
  }

  const value = useMemo(() => ({ checking, checkForUpdates }), [checking, checkForUpdates]);
  return (
    <UpdateContext.Provider value={value}>
      {children}
      {visible ? (
        <Portal>
          <Dialog
            visible
            onDismiss={() => {
              if (progress === undefined || progress >= 1) setVisible(false);
            }}
          >
            <Dialog.Title>
              {error
                ? '更新失败'
                : latestVersion
                  ? '检查更新'
                  : progress !== undefined && progress < 1
                    ? '正在下载更新'
                    : '发现新版本'}
            </Dialog.Title>
            <Dialog.Content>
              {error ? (
                <Text>{error}</Text>
              ) : latestVersion ? (
                <View style={{ gap: 8 }}>
                  <Text>当前已是最新版本 {latestVersion}</Text>
                  <Divider />
                  <Text>更新日志</Text>
                  <Dialog.ScrollArea style={{ marginBottom: 0, paddingHorizontal: 0 }}>
                    <ScrollView style={{ maxHeight: NOTES_MAX_HEIGHT }}>
                      <ReleaseNotes notes={currentRelease?.notes ?? '暂无更新日志。'} />
                    </ScrollView>
                  </Dialog.ScrollArea>
                </View>
              ) : release ? (
                <View style={{ gap: 8 }}>
                  <Text>当前版本：{currentVersion}</Text>
                  <Text>最新版本：{release.version}</Text>
                  <Divider />
                  <Text>更新日志</Text>
                  <Dialog.ScrollArea style={{ marginBottom: 0, paddingHorizontal: 0 }}>
                    <ScrollView style={{ maxHeight: NOTES_MAX_HEIGHT }}>
                      <ReleaseNotes notes={release.notes} />
                    </ScrollView>
                  </Dialog.ScrollArea>
                  {progress !== undefined ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <ProgressBar progress={progress} />
                      </View>
                      <Text>
                        {progress >= 1 ? '下载完成' : `已下载 ${Math.round(progress * 100)}%`}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={{ alignItems: 'center' }}>
                  <ActivityIndicator />
                </View>
              )}
            </Dialog.Content>
            <Dialog.Actions>
              {error && downloadedUri ? (
                <Button onPress={() => void openInstallSettings()}>打开安装权限</Button>
              ) : null}
              {error ? (
                <Button onPress={() => void (downloadedUri ? install() : download())}>重试</Button>
              ) : null}
              {!error && !(progress !== undefined && progress < 1) ? (
                <Button onPress={() => setVisible(false)}>关闭</Button>
              ) : null}
              {!error && release && progress === undefined ? (
                <Button onPress={() => void ignoreVersion()}>忽略本版本</Button>
              ) : null}
              {!error && release && progress === undefined ? (
                <Button
                  mode="contained"
                  style={{ minWidth: ACTION_MIN_WIDTH }}
                  onPress={() => void download()}
                >
                  下载
                </Button>
              ) : null}
              {!error && progress !== undefined && progress >= 1 ? (
                <Button
                  mode="contained"
                  style={{ minWidth: ACTION_MIN_WIDTH }}
                  onPress={() => void install()}
                >
                  安装
                </Button>
              ) : null}
            </Dialog.Actions>
          </Dialog>
        </Portal>
      ) : null}
    </UpdateContext.Provider>
  );
}
