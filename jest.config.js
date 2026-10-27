module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  transformIgnorePatterns: ['node_modules/(?!(@noble/|react-native-markdown-display))'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^react-native-markdown-display$': '<rootDir>/__mocks__/react-native-markdown-display.tsx',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
};
