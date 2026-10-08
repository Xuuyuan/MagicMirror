import type { MD3Theme } from 'react-native-paper';
import { presetPalettes, type PaletteScheme } from './theme-presets.generated';

/** 默认种子色：蓝。 */
export const defaultSeedColor = '#0B57D0';

// ---- HSV 近似（自定义种子色兜底用；预设色走预生成的官方调色板） ----

interface Hsv { h: number; s: number; v: number }

function hexToHsv(value: string): Hsv {
  const int = parseInt(value.slice(1), 16);
  const r = ((int >> 16) & 255) / 255; const g = ((int >> 8) & 255) / 255; const b = (int & 255) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const segment = Math.floor(h / 60) % 6;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][segment];
  const channels = rgb.map((component) => Math.round((component + m) * 255));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function shift(value: string, hueOffset: number, sMul: number, vMul: number, vAdd = 0): string {
  const hsv = hexToHsv(value);
  return hsvToHex({ h: (hsv.h + hueOffset + 360) % 360, s: Math.min(1, hsv.s * sMul), v: Math.min(1, Math.max(0, hsv.v * vMul + vAdd)) });
}

/** 自定义种子色的近似方案：以种子色相生成明暗梯度，视觉接近 MD3（非官方精确调色板）。 */
function approximateScheme(seed: string, dark: boolean): PaletteScheme {
  if (!dark) {
    return {
      primary: shift(seed, 0, 1, 0.72), onPrimary: '#ffffff', primaryContainer: shift(seed, 0, 0.45, 0.96), onPrimaryContainer: shift(seed, 0, 1, 0.22),
      secondary: shift(seed, 0, 0.42, 0.66), onSecondary: '#ffffff', secondaryContainer: shift(seed, 0, 0.25, 0.94), onSecondaryContainer: shift(seed, 0, 0.5, 0.2),
      tertiary: shift(seed, 60, 0.55, 0.65), onTertiary: '#ffffff', tertiaryContainer: shift(seed, 60, 0.3, 0.94), onTertiaryContainer: shift(seed, 60, 0.4, 0.18),
      background: shift(seed, 0, 0.06, 0.99), onBackground: shift(seed, 0, 0.1, 0.12),
      surface: shift(seed, 0, 0.06, 0.99), onSurface: shift(seed, 0, 0.1, 0.12),
      surfaceVariant: shift(seed, 0, 0.14, 0.92), onSurfaceVariant: shift(seed, 0, 0.1, 0.3),
      outline: shift(seed, 0, 0.12, 0.5), outlineVariant: shift(seed, 0, 0.12, 0.82),
      inverseSurface: shift(seed, 0, 0.08, 0.2), inverseOnSurface: shift(seed, 0, 0.06, 0.95), inversePrimary: shift(seed, 0, 1, 0.82),
    };
  }
  return {
    primary: shift(seed, 0, 1, 0.55, 0.45), onPrimary: shift(seed, 0, 1, 0.2), primaryContainer: shift(seed, 0, 1, 0.36), onPrimaryContainer: shift(seed, 0, 0.45, 0.92),
    secondary: shift(seed, 0, 0.4, 0.5, 0.5), onSecondary: shift(seed, 0, 0.6, 0.16), secondaryContainer: shift(seed, 0, 0.4, 0.3), onSecondaryContainer: shift(seed, 0, 0.3, 0.9),
    tertiary: shift(seed, 60, 0.45, 0.5, 0.5), onTertiary: shift(seed, 60, 0.6, 0.16), tertiaryContainer: shift(seed, 60, 0.4, 0.3), onTertiaryContainer: shift(seed, 60, 0.3, 0.9),
    background: shift(seed, 0, 0.08, 0.11), onBackground: shift(seed, 0, 0.06, 0.9),
    surface: shift(seed, 0, 0.08, 0.11), onSurface: shift(seed, 0, 0.06, 0.9),
    surfaceVariant: shift(seed, 0, 0.14, 0.28), onSurfaceVariant: shift(seed, 0, 0.06, 0.82),
    outline: shift(seed, 0, 0.06, 0.6), outlineVariant: shift(seed, 0, 0.12, 0.3),
    inverseSurface: shift(seed, 0, 0.06, 0.92), inverseOnSurface: shift(seed, 0, 0.08, 0.12), inversePrimary: shift(seed, 0, 1, 0.72),
  };
}

/** 按官方 MD3 规范把种子色调色板映射到浅色/深色方案；种子色非六位十六进制时回退默认紫。 */
export function schemeColors(seedColor: string, dark: boolean): Partial<MD3Theme['colors']> {
  // 预设色使用预生成的官方调色板（见 tools/generate-theme-palettes.mjs）；自定义色用 HSV 近似。
  const normalized = /^#?[0-9a-fA-F]{6}$/.test(seedColor) ? `#${seedColor.replace(/^#/, '').toUpperCase()}` : defaultSeedColor.toUpperCase();
  const preset = presetPalettes[normalized];
  const colors = preset ? preset[dark ? 'dark' : 'light'] : approximateScheme(normalized, dark);
  return colors;
}
