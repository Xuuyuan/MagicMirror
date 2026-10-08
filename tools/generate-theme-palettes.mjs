/**
 * 一次性生成预设主题色调色板：node tools/generate-theme-palettes.mjs
 *
 * 运行环境是 Node（官方库在 Node 下完全正常，但在 Metro/Hermes 上不可用），
 * 因此预设色的 MD3 调色板在这里预生成并写入 src/theme-presets.generated.ts，
 * 应用运行时直接查表；自定义种子色由 src/theme.ts 的 HSV 近似算法兜底。
 * 新增预设色后重跑本脚本即可。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities';

const presets = [
  { label: '蓝', value: '#0B57D0' },
  { label: '绿', value: '#2E7D32' },
  { label: '黄', value: '#F9AB00' },
  { label: '红', value: '#C62828' },
];

const hex = (palette, tone) => hexFromArgb(palette.tone(tone));

function scheme(seed, dark) {
  const { primary, secondary, tertiary, neutral, neutralVariant } = themeFromSourceColor(argbFromHex(seed)).palettes;
  if (!dark) {
    return {
      primary: hex(primary, 40), onPrimary: hex(primary, 100), primaryContainer: hex(primary, 90), onPrimaryContainer: hex(primary, 10),
      secondary: hex(secondary, 40), onSecondary: hex(secondary, 100), secondaryContainer: hex(secondary, 90), onSecondaryContainer: hex(secondary, 10),
      tertiary: hex(tertiary, 40), onTertiary: hex(tertiary, 100), tertiaryContainer: hex(tertiary, 90), onTertiaryContainer: hex(tertiary, 10),
      background: hex(neutral, 99), onBackground: hex(neutral, 10),
      surface: hex(neutral, 99), onSurface: hex(neutral, 10),
      surfaceVariant: hex(neutralVariant, 90), onSurfaceVariant: hex(neutralVariant, 30),
      outline: hex(neutralVariant, 50), outlineVariant: hex(neutralVariant, 80),
      inverseSurface: hex(neutral, 20), inverseOnSurface: hex(neutral, 95), inversePrimary: hex(primary, 80),
    };
  }
  return {
    primary: hex(primary, 80), onPrimary: hex(primary, 20), primaryContainer: hex(primary, 30), onPrimaryContainer: hex(primary, 90),
    secondary: hex(secondary, 80), onSecondary: hex(secondary, 20), secondaryContainer: hex(secondary, 30), onSecondaryContainer: hex(secondary, 90),
    tertiary: hex(tertiary, 80), onTertiary: hex(tertiary, 20), tertiaryContainer: hex(tertiary, 30), onTertiaryContainer: hex(tertiary, 90),
    background: hex(neutral, 10), onBackground: hex(neutral, 90),
    surface: hex(neutral, 10), onSurface: hex(neutral, 90),
    surfaceVariant: hex(neutralVariant, 30), onSurfaceVariant: hex(neutralVariant, 80),
    outline: hex(neutralVariant, 60), outlineVariant: hex(neutralVariant, 30),
    inverseSurface: hex(neutral, 90), inverseOnSurface: hex(neutral, 10), inversePrimary: hex(primary, 40),
  };
}

function indent(value) {
  return JSON.stringify(value, null, 2).replace(/\n/g, '\n    ');
}

const entries = presets.map(({ label, value }) =>
  `  /** ${label} */\n  '${value.toUpperCase()}': {\n    light: ${indent(scheme(value, false))},\n    dark: ${indent(scheme(value, true))},\n  }`);

const content = `/**
 * 由 tools/generate-theme-palettes.mjs 用 @material/material-color-utilities 预生成的
 * 预设主题色调色板（浅色/深色）；勿手改。运行环境说明见脚本头部注释。
 * 键为大写种子色（#RRGGBB）。
 */
export interface PaletteScheme {
  primary: string; onPrimary: string; primaryContainer: string; onPrimaryContainer: string;
  secondary: string; onSecondary: string; secondaryContainer: string; onSecondaryContainer: string;
  tertiary: string; onTertiary: string; tertiaryContainer: string; onTertiaryContainer: string;
  background: string; onBackground: string;
  surface: string; onSurface: string;
  surfaceVariant: string; onSurfaceVariant: string;
  outline: string; outlineVariant: string;
  inverseSurface: string; inverseOnSurface: string; inversePrimary: string;
}

export const presetPalettes: Record<string, { light: PaletteScheme; dark: PaletteScheme }> = {
${entries.join(',\n')}
};
`;

mkdirSync(new URL('../src/', import.meta.url), { recursive: true });
writeFileSync(new URL('../src/theme-presets.generated.ts', import.meta.url), content);
console.log('generated src/theme-presets.generated.ts');
