import { Redis } from 'ioredis';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger({ namespace: 'cache' });

let client: Redis | null = null;
let unavailable = false;
let warned = false;


if(config.cacheDisabled === "false") {
  log.info("Redis cache is enabled")
} else {
  log.info("Redis cache is disabled")
}

function warnOnce(): void {
  if (!warned) {
    warned = true;
    log.warn('Redis unavailable, serving from DB');
  }
}

function getClient(): Redis | null {
  if (unavailable) return null;
  if (client) return client;
  if (!config.redisUrl) return null;
  if (config.cacheDisabled === "true") return null;
  try {
    const created = new Redis(config.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    created.on('error', () => {
      unavailable = true;
      warnOnce();
    });
    client = created;
    return client;
  } catch {
    unavailable = true;
    warnOnce();
    return null;
  }
}

await getClient();

export async function cacheGet<T>(key: string): Promise<T | null> {
  return log.timerFn(`cache get ${key}`, async () => {
    try {
      const redis = getClient();
      if (!redis) return null;
      const raw = await redis.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      warnOnce();
      return null;
    }
  }, 'debug');
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await log.timerFn(`cache set ${key}`, async () => {
    try {
      const redis = getClient();
      if (!redis) return;
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      warnOnce();
    }
  }, 'debug');
}

export async function cacheDel(key: string): Promise<void> {
  await log.timerFn(`cache del ${key}`, async () => {
    try {
      const redis = getClient();
      if (!redis) return;
      await redis.del(key);
    } catch {
      warnOnce();
    }
  }, 'debug');
}

export async function cacheDelPrefix(prefix: string): Promise<void> {
  await log.timerFn(`cache del prefix ${prefix}`, async () => {
    try {
      const redis = getClient();
      if (!redis) return;
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch {
      warnOnce();
    }
  }, 'debug');
}

// Full flush. The cache is purely derived data, so a completed sync may wipe
// it wholesale — this also evicts any stale entries written while the
// database was still empty (e.g. requests during first-run bootstrap).
export async function cacheFlush(): Promise<void> {
  await log.timerFn('cache flush', async () => {
    try {
      const redis = getClient();
      if (!redis) return;
      await redis.flushdb();
    } catch {
      warnOnce();
    }
  }, 'debug');
}
