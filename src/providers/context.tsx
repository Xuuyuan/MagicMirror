import { useEffect, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { PaperProvider, MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccountsProvider } from '@/src/accounts-context';
import { hydratePreferences, useAppStore } from '@/src/state/app';
import { schemeColors } from '@/src/theme';
import { ProviderError } from '@/src/domain/models';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: (failureCount, error) => failureCount < 1 && error instanceof ProviderError && error.retryable, staleTime: 60000 } } });
export function AppProviders() {
  const selected = useAppStore((s) => s.theme);
  const seedColor = useAppStore((s) => s.seedColor);
  const system = useColorScheme();
  const dark = selected === 'dark' || (selected === 'system' && system === 'dark');
  useEffect(() => { void hydratePreferences(); }, []);
  const theme = useMemo(() => {
    const base = dark ? MD3DarkTheme : MD3LightTheme;
    return { ...base, colors: { ...base.colors, ...schemeColors(seedColor, dark) } };
  }, [seedColor, dark]);
  return <SafeAreaProvider><PaperProvider theme={theme} settings={{ icon: (props) => <MaterialCommunityIcons {...props} /> }}><QueryClientProvider client={queryClient}><AccountsProvider><StatusBar style={dark ? 'light' : 'dark'} /><Stack screenOptions={{ headerShown: false, animation: 'fade', statusBarStyle: dark ? 'light' : 'dark', contentStyle: { backgroundColor: theme.colors.background } }} /></AccountsProvider></QueryClientProvider></PaperProvider></SafeAreaProvider>;
}
