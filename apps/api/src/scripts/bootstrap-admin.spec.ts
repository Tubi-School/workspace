import { acquireBootstrapAdminLock, parseArgs } from './bootstrap-admin.js';

describe('acquireBootstrapAdminLock', () => {
  it('uses $executeRaw, never $queryRaw, for the void-returning advisory-lock call', async () => {
    // pg_advisory_xact_lock returns PostgreSQL `void`, which `$queryRaw`
    // cannot deserialize ("Failed to deserialize column of type 'void'" —
    // the exact production failure this test guards against). A fake
    // whose `$queryRaw` throws proves the fix never calls it for this
    // statement; `$executeRaw` returning a plain row-count (no
    // deserialization attempt) proves the call still succeeds.
    const queryRaw = jest.fn(() => {
      throw new Error('$queryRaw must not be called for a void-returning statement');
    });
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = { $queryRaw: queryRaw, $executeRaw: executeRaw };

    await expect(acquireBootstrapAdminLock(tx)).resolves.toBeUndefined();

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('locks on the same fixed key every call (transaction-scoped serialization is keyed, not per-invocation-random)', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = { $queryRaw: jest.fn(), $executeRaw: executeRaw };

    await acquireBootstrapAdminLock(tx);
    await acquireBootstrapAdminLock(tx);

    // Prisma's tagged-template raw-query helpers pass the interpolated
    // values as a strings array followed by the values themselves — the
    // lock key value must be identical (and non-empty) across calls, or
    // two invocations could take different locks and never actually
    // serialize against each other.
    const [, keyFirstCall] = executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    const [, keySecondCall] = executeRaw.mock.calls[1] as [TemplateStringsArray, string];
    expect(keyFirstCall).toBe(keySecondCall);
    expect(keyFirstCall.length).toBeGreaterThan(0);
  });
});

describe('bootstrap-admin parseArgs', () => {
  it('parses --email and --name', () => {
    expect(parseArgs(['--email', 'admin@school.example', '--name', 'Founder Admin'])).toEqual({
      email: 'admin@school.example',
      fullName: 'Founder Admin',
      allowAdditional: false,
    });
  });

  it('recognizes --allow-additional', () => {
    const result = parseArgs([
      '--email',
      'admin@school.example',
      '--name',
      'Founder Admin',
      '--allow-additional',
    ]);
    expect(result?.allowAdditional).toBe(true);
  });

  it('trims surrounding whitespace from email and name', () => {
    const result = parseArgs([
      '--email',
      '  admin@school.example  ',
      '--name',
      '  Founder Admin  ',
    ]);
    expect(result).toEqual({
      email: 'admin@school.example',
      fullName: 'Founder Admin',
      allowAdditional: false,
    });
  });

  it('lowercases the email to match AuthService.normalizeEmail, so the created account can log in', () => {
    const result = parseArgs(['--email', 'Admin@School.Example', '--name', 'Founder Admin']);
    expect(result?.email).toBe('admin@school.example');
  });

  it('lowercases and trims together, without altering name casing', () => {
    const result = parseArgs(['--email', '  Admin@School.Example  ', '--name', 'Founder Admin']);
    expect(result).toEqual({
      email: 'admin@school.example',
      fullName: 'Founder Admin',
      allowAdditional: false,
    });
  });

  it('returns null when --email is missing', () => {
    expect(parseArgs(['--name', 'Founder Admin'])).toBeNull();
  });

  it('returns null when --name is missing', () => {
    expect(parseArgs(['--email', 'admin@school.example'])).toBeNull();
  });

  it('returns null for empty argv', () => {
    expect(parseArgs([])).toBeNull();
  });
});
