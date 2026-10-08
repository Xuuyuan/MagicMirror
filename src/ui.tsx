import { Animated, Platform, Pressable, ScrollView, StyleSheet, ToastAndroid, View, type ViewProps } from 'react-native';
import { ActivityIndicator, Appbar, Button, Card as PaperCard, Text, useTheme } from 'react-native-paper';
import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProviderError } from '@/src/domain/models';
import { isLoginRequiredError } from '@/src/services/errors';
import { DiagnosticButton } from './diagnostic-button';
import { useAppStore } from './state/app';
export function Screen({ children, ...props }: ViewProps) { const theme = useTheme(); const debugMode = useAppStore((state) => state.debugMode); return <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}><View style={{ flex: 1 }} {...props}>{children}{debugMode ? <View style={styles.debugBar}><DiagnosticButton /></View> : null}</View></SafeAreaView>; }
/** 返回上一页；没有历史栈（如深链直达）时回到主页。用 back 而不是 replace，避免往栈里堆叠重复页面。 */
export function backOrHome(): void { if (router.canGoBack()) router.back(); else router.replace('/'); }
export function Header({ title, subtitle, back = false, leading, trailing, onTitlePress, fitTitle = false }: { title: string; subtitle?: string; back?: boolean; leading?: React.ReactNode; trailing?: React.ReactNode; onTitlePress?: () => void; fitTitle?: boolean }) {
  const theme = useTheme();
  const titleText = subtitle ? <View style={{ justifyContent: 'center' }}><Text variant="titleLarge" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit style={{ lineHeight: 24, includeFontPadding: false }}>{title}</Text><Text variant="bodySmall" numberOfLines={2} adjustsFontSizeToFit ellipsizeMode="clip" style={{ maxHeight: 28, lineHeight: 14, includeFontPadding: false, color: theme.colors.onSurfaceVariant }}>{subtitle}</Text></View> : fitTitle ? <Text variant="titleLarge" accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit ellipsizeMode="clip" style={styles.fittedTitle}>{title}</Text> : <Text variant="titleLarge">{title}</Text>;
  const titleNode = onTitlePress ? <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onTitlePress}>{titleText}</Pressable> : fitTitle || subtitle ? titleText : title;
  return <Appbar.Header>{back ? <Appbar.BackAction onPress={backOrHome} /> : leading}<Appbar.Content title={titleNode} />{trailing}</Appbar.Header>;
}
export function Body({ children }: { children: React.ReactNode }) { return <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>; }
/** 统一的小角标（考试性质、等第等），主题色容器。 */
export function Badge({ label }: { label: string }) { const theme = useTheme(); return <View style={{ borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: theme.colors.secondaryContainer }}><Text style={{ fontSize: 11, color: theme.colors.onSecondaryContainer }}>{label}</Text></View>; }
/** Android 底部短暂提示，稍候自动消失；系统级 toast，在 Modal 之上同样可见，不占用页面布局。 */
export function showToast(message: string): void { if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT); }
/** 双击检测：intervalMs 内的第二次点按触发回调（值取当次点按），单击只重置计时、无副作用。 */
export function useDoubleTap<T>(onDoubleTap: (value: T) => void, intervalMs = 500): (value: T) => void {
  const lastTap = useRef<{ timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => () => { if (lastTap.current) clearTimeout(lastTap.current.timer); }, []);
  return useCallback((value: T) => {
    const previous = lastTap.current;
    if (previous) {
      clearTimeout(previous.timer);
      lastTap.current = null;
      onDoubleTap(value);
      return;
    }
    lastTap.current = { timer: setTimeout(() => { lastTap.current = null; }, intervalMs) };
  }, [onDoubleTap, intervalMs]);
}
export function LoadingState({ label = '正在加载…' }: { label?: string }) { const [animation] = useState(() => ({ opacity: new Animated.Value(0), translateY: new Animated.Value(8) })); useEffect(() => { Animated.parallel([Animated.timing(animation.opacity, { toValue: 1, duration: 220, useNativeDriver: true }), Animated.timing(animation.translateY, { toValue: 0, duration: 220, useNativeDriver: true })]).start(); }, [animation]); return <Animated.View accessibilityRole="progressbar" style={{ alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, opacity: animation.opacity, transform: [{ translateY: animation.translateY }] }}><ActivityIndicator /><Text>{label}</Text></Animated.View>; }
export function Card({ children, style, compact = false }: { children: React.ReactNode; style?: object; compact?: boolean }) { return <PaperCard mode="contained" style={style}><PaperCard.Content style={compact ? { paddingVertical: 0 } : { paddingVertical: 10, gap: 8 }}>{children}</PaperCard.Content></PaperCard>; }
export function ErrorCard({ error, retry, accountId }: { error: unknown; retry?: () => void; accountId?: string }) { const theme = useTheme(); const loginRequired = isLoginRequiredError(error); const restricted = error instanceof ProviderError && error.code === 'RESTRICTED'; return <Card><Text style={{ color: theme.colors.error }}>{error instanceof ProviderError ? error.message : '加载失败，请检查网络或稍后重试'}</Text>{retry && <Button onPress={retry}>重试</Button>}{loginRequired && accountId && <Button mode="contained" onPress={() => router.push({ pathname: '/account-edit', params: { id: accountId } })}>重新登录 / 编辑账号</Button>}{restricted && accountId && <Button mode="contained" onPress={() => router.push({ pathname: '/haofenshu-webview', params: { accountId, mode: 'login' } })}>使用官方网页登录</Button>}</Card>; }
const styles = StyleSheet.create({ fittedTitle: { height: 48, lineHeight: 24, textAlignVertical: 'center' }, body: { padding: 16, gap: 12, paddingBottom: 24 }, debugBar: { alignItems: 'flex-end', paddingHorizontal: 12, paddingBottom: 4 } });
