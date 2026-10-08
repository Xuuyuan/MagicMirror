/**
 * 测试环境替身：expo-crypto 是以 ESM + 原生模块形式发布的，Jest（testEnvironment: node）
 * 既无法直接引入，也没有原生实现。Provider 的单测一律自行注入随机源，这里只保证模块可被加载。
 */
const getRandomBytes = (size: number) => Uint8Array.from({ length: size }, (_, index) => ((index * 7 + 11) % 255) + 1);

module.exports = { getRandomBytes };
