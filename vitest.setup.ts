import '@testing-library/jest-dom/vitest';

process.env.NODE_ENV ??= 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';
process.env.DATABASE_PATH ??= ':memory:';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.AUTH_MODE ??= 'optional';
