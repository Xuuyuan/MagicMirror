import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { defaultSeedColor } from '@/src/theme';
import { setDiagnosticDebugMode } from '@/src/services/diagnostics';
import { isGradeDisplayMode, type GradeDisplayMode } from '@/src/services/score-display';

type Theme = 'system' | 'light' | 'dark';
interface AppState { theme: Theme; seedColor: string; debugMode: boolean; showAbsentSubjects: boolean; septnetGradeDisplay: GradeDisplayMode; setShowAbsentSubjects: (show: boolean) => void; setSeptnetGradeDisplay: (mode: GradeDisplayMode) => void; setTheme: (theme: Theme) => void; setSeedColor: (seedColor: string) => void; enableDebugMode: () => void; }

export const useAppStore = create<AppState>((set) => ({
  theme: 'system',
  seedColor: defaultSeedColor,
  debugMode: false,
  showAbsentSubjects: true,
  septnetGradeDisplay: 'both',
  setShowAbsentSubjects: (showAbsentSubjects) => set({ showAbsentSubjects }),
  setSeptnetGradeDisplay: (septnetGradeDisplay) => set({ septnetGradeDisplay }),
  setTheme: (theme) => set({ theme }),
  setSeedColor: (seedColor) => set({ seedColor }),
  enableDebugMode: () => { setDiagnosticDebugMode(true); set({ debugMode: true }); },
}));

// 偏好非敏感但体积极小，直接用现成的 SecureStore（避免为 AsyncStorage 新增依赖）。
// zustand persist 中间件与 expo-secure-store 适配在 Hermes 上初始化即崩（undefined is not a function），故手动读写。
const STORAGE_KEY = 'magicmirror.ui.v1';
let hydrationStarted = false;

/** 从安全存储恢复显示偏好；幂等，应用启动时调用一次。读不到或损坏时保持默认值。 */
export async function hydratePreferences(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    // 一次恢复全部字段，避免中间状态写回存储时遗漏其他已保存偏好。
    useAppStore.setState({
      ...(record.theme === 'system' || record.theme === 'light' || record.theme === 'dark' ? { theme: record.theme } : {}),
      ...(typeof record.seedColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(record.seedColor) ? { seedColor: record.seedColor } : {}),
      ...(typeof record.showAbsentSubjects === 'boolean' ? { showAbsentSubjects: record.showAbsentSubjects } : {}),
      ...(isGradeDisplayMode(record.septnetGradeDisplay) ? { septnetGradeDisplay: record.septnetGradeDisplay } : {}),
    });
  } catch {
    // 偏好读取失败不影响使用，保持默认值。
  }
}

useAppStore.subscribe((state) => {
  void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ theme: state.theme, seedColor: state.seedColor,
    showAbsentSubjects: state.showAbsentSubjects, septnetGradeDisplay: state.septnetGradeDisplay })).catch(() => {
    // 偏好写入失败不阻塞使用，重启后回退默认值。
  });
});
