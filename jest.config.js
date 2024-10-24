module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/__tests__'],
    setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
    testMatch: ['**/__tests__/**/*.test.js'],
    collectCoverage: true,
    collectCoverageFrom: [
        'commands/**/*.js',
        'game/**/*.js',
        'utils/**/*.js'
    ],
    coverageDirectory: 'coverage',
    verbose: true,
    moduleDirectories: ['node_modules', '<rootDir>/__mocks__'],
    moduleNameMapper: {
        '^discord\\.js$': '<rootDir>/__mocks__/discord.js/index.js',
    },
};
