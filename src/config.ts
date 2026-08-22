import 'dotenv/config';
import { z } from 'zod';

export const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().min(1).default('./data/ps99.db'),
  REDIS_URL: z.string().min(1).optional(),
  SYNC_CRON: z.string().min(1).default('0 */4 * * *'),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const details = z.treeifyError(parsed.error);
  console.error('Invalid environment configuration:', JSON.stringify(details, null, 2));
  throw new Error(
    `Invalid environment variables: ${parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ')}`,
  );
}

export const config = Object.freeze({
  port: parsed.data.PORT,
  dbPath: parsed.data.DB_PATH,
  redisUrl: parsed.data.REDIS_URL,
  syncCron: parsed.data.SYNC_CRON,
});
