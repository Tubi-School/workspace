import { parseArgs } from './bootstrap-admin.js';

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
