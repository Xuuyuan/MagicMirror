import type { ReactElement, ReactNode } from 'react';
import { AppProviders } from '../providers/context';

const { renderToStaticMarkup } = jest.requireActual<{ renderToStaticMarkup: (element: ReactElement) => string }>('react-dom/server');
let mockSelected: 'system' | 'light' | 'dark' = 'system';
let mockSystem: 'light' | 'dark' = 'light';

jest.mock('react-native', () => ({ useColorScheme: () => mockSystem }));
jest.mock('expo-status-bar', () => ({ StatusBar: ({ style }: { style: string }) => <span data-status-bar={style} /> }));
jest.mock('expo-router', () => ({ Stack: ({ screenOptions }: { screenOptions: { statusBarStyle: string } }) => <span data-stack-status-bar={screenOptions.statusBarStyle} /> }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => () => null);
jest.mock('react-native-paper', () => ({
  PaperProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  MD3LightTheme: { colors: {} }, MD3DarkTheme: { colors: {} },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
jest.mock('@tanstack/react-query', () => ({ QueryClient: class {}, QueryClientProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
jest.mock('../accounts-context', () => ({ AccountsProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
jest.mock('../state/app', () => ({
  hydratePreferences: jest.fn(),
  useAppStore: (selector: (state: { theme: typeof mockSelected; seedColor: string }) => unknown) => selector({ theme: mockSelected, seedColor: '#0B57D0' }),
}));

it.each([
  ['light', 'light', 'dark'],
  ['light', 'dark', 'dark'],
  ['dark', 'light', 'light'],
  ['dark', 'dark', 'light'],
  ['system', 'light', 'dark'],
  ['system', 'dark', 'light'],
] as const)('applies %s App theme with %s system theme to both status bar owners', (selected, system, expected) => {
  mockSelected = selected;
  mockSystem = system;
  const markup = renderToStaticMarkup(<AppProviders />);
  expect(markup).toContain(`data-status-bar="${expected}"`);
  expect(markup).toContain(`data-stack-status-bar="${expected}"`);
});
