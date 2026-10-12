/**
 * 测试环境替身：expo-device 以 ESM + 原生模块形式发布，Jest（testEnvironment: node）
 * 无法直接引入，也没有原生实现。这里只保证模块可被加载；需要设备架构的用例自行
 * 用 jest.mock 覆盖 supportedCpuArchitectures。返回 null 时更新服务会回退 all 包。
 */
module.exports = { supportedCpuArchitectures: null };
