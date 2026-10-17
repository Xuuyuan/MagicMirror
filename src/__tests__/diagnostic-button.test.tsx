/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import * as Clipboard from 'expo-clipboard';
import { DiagnosticButton } from '../diagnostic-button';
import { clearDiagnostics, diagnosticSnapshot, recordDiagnostic, setDiagnosticDebugMode } from '../services/diagnostics';

let mockDebugMode = false;
jest.mock('../state/app', () => ({ useAppStore: (selector: (state: { debugMode: boolean }) => unknown) => selector({ debugMode: mockDebugMode }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: 'fictional-version' } } }));
jest.mock('react-native', () => ({ Platform: { OS: 'android', Version: 32 }, View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
jest.mock('react-native-paper', () => ({ Button: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => <button onClick={onPress}>{children}</button> }));
const { createRoot } = jest.requireActual<{ createRoot: (element: Element) => { render: (element: ReactNode) => void; unmount: () => void } }>('react-dom/client');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('only offers debug controls in debug mode and clears the current capture without disabling later capture', async () => {
  clearDiagnostics();
  setDiagnosticDebugMode(true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<DiagnosticButton />));
    expect(container.querySelectorAll('button')).toHaveLength(0);
    mockDebugMode = true;
    await act(async () => root.render(<DiagnosticButton />));
    const [copy, clear] = container.querySelectorAll('button');
    expect(clear.textContent).toBe('清除调试信息');
    expect(copy.parentElement).toBe(clear.parentElement);
    recordDiagnostic({ at: 'fictional-before', endpoint: 'test/before', outcome: 'response' });
    await act(async () => copy.click());
    expect(copy.textContent).toBe('已复制调试信息');
    await act(async () => clear.click());
    expect(diagnosticSnapshot()).toEqual([]);
    expect(copy.textContent).toBe('复制调试信息');
    recordDiagnostic({ at: 'fictional-after', endpoint: 'test/after', outcome: 'response' });
    await act(async () => copy.click());
    const payload = JSON.parse(jest.mocked(Clipboard.setStringAsync).mock.calls.at(-1)![0]);
    expect(payload.events).toEqual([{ at: 'fictional-after', endpoint: 'test/after', outcome: 'response' }]);
  } finally {
    await act(async () => root.unmount());
    container.remove(); mockDebugMode = false;
    clearDiagnostics(); setDiagnosticDebugMode(false);
  }
});
