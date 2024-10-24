// __tests__/setup.js

// Mock the logger module globally for all tests
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

// Optional: If you have other global mocks or configurations, add them here
