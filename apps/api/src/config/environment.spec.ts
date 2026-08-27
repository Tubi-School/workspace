import { validateEnvironment } from './environment.js';

const VALID_ENV = {
  NODE_ENV: 'production',
  PORT: '3001',
  DATABASE_URL: 'postgresql://user:pass@host:5432/db',
  CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
  APP_VERSION: '1.2.3',
  JWT_SECRET: 'a'.repeat(32),
  JWT_EXPIRES_IN: '1d',
};

describe('validateEnvironment', () => {
  it('accepts a fully specified, valid production environment', () => {
    const config = validateEnvironment(VALID_ENV);

    expect(config.NODE_ENV).toBe('production');
    expect(config.PORT).toBe(3001);
    expect(config.corsOrigins).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('fails clearly when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _unused, ...rest } = VALID_ENV;
    expect(() => validateEnvironment(rest)).toThrow(/DATABASE_URL/);
  });

  it('fails clearly when DATABASE_URL is not a postgres connection string', () => {
    expect(() =>
      validateEnvironment({ ...VALID_ENV, DATABASE_URL: 'mysql://user:pass@host/db' }),
    ).toThrow(/PostgreSQL/);
  });

  it('fails clearly when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _unused, ...rest } = VALID_ENV;
    expect(() => validateEnvironment(rest)).toThrow(/JWT_SECRET/);
  });

  it('fails clearly when JWT_SECRET is shorter than 32 characters', () => {
    expect(() => validateEnvironment({ ...VALID_ENV, JWT_SECRET: 'too-short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('fails clearly when NODE_ENV is not one of the recognised values', () => {
    expect(() => validateEnvironment({ ...VALID_ENV, NODE_ENV: 'staging' })).toThrow();
  });

  it('defaults PORT, CORS_ORIGINS, APP_VERSION and JWT_EXPIRES_IN when omitted', () => {
    const { PORT: _p, CORS_ORIGINS: _c, APP_VERSION: _a, JWT_EXPIRES_IN: _j, ...rest } = VALID_ENV;

    const config = validateEnvironment(rest);

    expect(config.PORT).toBe(3001);
    expect(config.corsOrigins).toEqual(['http://localhost:3000']);
    expect(config.APP_VERSION).toBe('0.0.0-dev');
    expect(config.JWT_EXPIRES_IN).toBe('1d');
  });

  it('normalises CORS_ORIGINS by trimming whitespace and dropping empty entries', () => {
    const config = validateEnvironment({
      ...VALID_ENV,
      CORS_ORIGINS: ' https://a.example.com ,, https://b.example.com,',
    });

    expect(config.corsOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });
});
