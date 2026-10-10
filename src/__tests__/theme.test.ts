import { defaultSeedColor, schemeColors } from '@/src/theme';

describe('主题色生成', () => {
  it('基于种子色生成浅色/深色方案，且主色随种子与明暗变化', () => {
    const blueLight = schemeColors('#0B57D0', false);
    const blueDark = schemeColors('#0B57D0', true);
    const pinkLight = schemeColors('#C2185B', false);
    expect(blueLight.background).not.toBe(blueDark.background);
    expect(blueLight.primary).not.toBe(blueDark.primary);
    expect(blueLight.primary).not.toBe(pinkLight.primary);
  });

  it('非法种子色回退默认紫且不抛错', () => {
    const fallback = schemeColors('#GGGGGG', false);
    const expected = schemeColors(defaultSeedColor, false);
    expect(fallback.primary).toBe(expected.primary);
  });

  it('接受不带 # 的六位十六进制', () => {
    expect(schemeColors('0B57D0', false).primary).toBe(schemeColors('#0B57D0', false).primary);
  });
});
