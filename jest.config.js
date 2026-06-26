module.exports = {
  transform: {
    '.tsx?$': 'ts-jest'
  },
  testRegex: '(/tests/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  testPathIgnorePatterns: ['/dist/', '/node_modules/', '/tests/helpers/legacy-helpers.js', '/tests/test-helpers.ts', '\\.fixture\\.ts$'],
  moduleFileExtensions: ['ts', 'tsx', 'jsx', 'js', 'json'],
  testEnvironment: 'node',
  collectCoverage: true,
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/*.ts',
    'src/helpers/*.ts',
    'src/models/*.ts',
    'src/services/*.ts'
  ],
  // Stage 2/3 convergence floor: jest itself fails if coverage drops below the
  // baseline established at v2.5.0 (83.2% stmts / 78.6% br). Catches a silent
  // regression while EOL deps are modernized; raise these as coverage improves.
  coverageThreshold: {
    global: {
      statements: 83,
      branches: 78,
      functions: 68,
      lines: 82
    }
  }
}
