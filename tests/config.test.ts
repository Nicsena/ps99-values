import { describe, expect, it } from 'vitest';
import { configSchema } from '../src/config.js';

describe('configSchema', () => {
  it('validates defaults with empty env input', () => {
    const parsed = configSchema.parse({});
    expect(parsed.PORT).toBe(3000);
    expect(parsed.DB_PATH).toBe('./data/ps99.db');
    expect(parsed.SYNC_CRON).toBe('0 */1 * * *');
    expect(parsed.REDIS_URL).toBeUndefined();
  });

  it('coerces PORT string to number', () => {
    const parsed = configSchema.parse({ PORT: '8080' });
    expect(parsed.PORT).toBe(8080);
  });

  it('rejects invalid PORT', () => {
    expect(configSchema.safeParse({ PORT: 'not-a-number' }).success).toBe(false);
  });

  it('keeps optional REDIS_URL when provided', () => {
    const parsed = configSchema.parse({ REDIS_URL: 'redis://localhost:6379' });
    expect(parsed.REDIS_URL).toBe('redis://localhost:6379');
  });
});
