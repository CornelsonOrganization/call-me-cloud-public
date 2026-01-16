/**
 * Redis Storage Provider
 *
 * Implements conversation persistence using Redis with automatic TTL.
 * Designed for Railway's Redis service but works with any Redis instance.
 *
 * Features:
 * - Automatic TTL-based expiration (cleanup is a no-op)
 * - Connection health checking with automatic reconnection
 * - Graceful error handling for network issues
 * - Key prefix support for multi-tenant deployments
 *
 * Configuration:
 * - redisUrl: Connection string (e.g., redis://localhost:6379 or Railway's REDIS_URL)
 * - keyPrefix: Optional prefix for all keys (useful for multi-tenant deployments)
 * - ttlSeconds: Time-to-live in seconds (default: 172800 = 2 days)
 */

import Redis from 'ioredis';
import type { StorageProvider, StorageConfig, ConversationRecord } from './types.js';

/** Default TTL: 2 days in seconds */
const DEFAULT_TTL_SECONDS = 172800;

/** Health check interval in milliseconds */
const HEALTH_CHECK_INTERVAL_MS = 30000;

/** Reconnection delay in milliseconds */
const RECONNECT_DELAY_MS = 5000;

/** Maximum reconnection attempts */
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Redis-specific configuration options
 * Passed via StorageConfig.options
 */
export interface RedisStoreOptions {
  /** Redis connection URL (e.g., redis://localhost:6379) */
  redisUrl: string;
  /** Optional prefix for all storage keys */
  keyPrefix?: string;
  /** TTL in seconds (default: 172800 = 2 days) */
  ttlSeconds?: number;
}

export class RedisStore implements StorageProvider {
  private client: Redis | null = null;
  private config: StorageConfig | null = null;
  private redisOptions: Required<RedisStoreOptions> = {
    redisUrl: '',
    keyPrefix: '',
    ttlSeconds: DEFAULT_TTL_SECONDS,
  };

  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;

  /**
   * Create a new RedisStore instance
   * @param config - Storage configuration with Redis options
   */
  constructor(config?: StorageConfig) {
    if (config) {
      this.config = config;
    }
  }

  /**
   * Initialize the Redis connection
   * Configuration can be passed via constructor or environment variables
   */
  async initialize(): Promise<void> {
    // Extract Redis-specific options from config
    const options = this.config?.options as Partial<RedisStoreOptions> | undefined;

    // Get Redis URL from config or environment
    const redisUrl =
      options?.redisUrl ||
      this.config?.connectionString ||
      process.env.REDIS_URL ||
      process.env.CALLME_REDIS_URL;

    if (!redisUrl) {
      throw new Error(
        'RedisStore requires a Redis URL. Provide it via config.options.redisUrl, ' +
          'config.connectionString, or REDIS_URL/CALLME_REDIS_URL environment variable.'
      );
    }

    // Get optional key prefix
    const keyPrefix = options?.keyPrefix || '';

    // Get TTL from config (convert from ms to seconds if needed)
    let ttlSeconds = DEFAULT_TTL_SECONDS;
    if (options?.ttlSeconds) {
      ttlSeconds = options.ttlSeconds;
    } else if (this.config?.defaultTtlMs) {
      ttlSeconds = Math.floor(this.config.defaultTtlMs / 1000);
    }

    this.redisOptions = {
      redisUrl,
      keyPrefix,
      ttlSeconds,
    };

    await this.connect();
  }

  /**
   * Establish Redis connection with event handlers
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = new Redis(this.redisOptions.redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > MAX_RECONNECT_ATTEMPTS) {
            console.error(
              `[RedisStore] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`
            );
            return null; // Stop retrying
          }
          const delay = Math.min(times * RECONNECT_DELAY_MS, 30000);
          console.error(
            `[RedisStore] Retrying connection in ${delay}ms (attempt ${times})`
          );
          return delay;
        },
        lazyConnect: false,
      });

      this.client.on('connect', () => {
        console.error('[RedisStore] Connected to Redis');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHealthCheck();
      });

      this.client.on('ready', () => {
        console.error('[RedisStore] Redis client ready');
        resolve();
      });

      this.client.on('error', (err) => {
        console.error('[RedisStore] Redis error:', err.message);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        console.error('[RedisStore] Redis connection closed');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        this.reconnectAttempts++;
        console.error(
          `[RedisStore] Reconnecting (attempt ${this.reconnectAttempts})`
        );
      });

      this.client.on('end', () => {
        console.error('[RedisStore] Redis connection ended');
        this.isConnected = false;
        this.stopHealthCheck();
      });

      // Handle initial connection failure
      this.client.once('error', (err) => {
        if (!this.isConnected) {
          reject(new Error(`Failed to connect to Redis: ${err.message}`));
        }
      });

      // Set a timeout for initial connection
      const timeout = setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Redis connection timeout'));
        }
      }, 10000);

      this.client.once('ready', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Get the full key with prefix
   */
  private getKey(id: string): string {
    const prefix = this.redisOptions.keyPrefix
      ? `${this.redisOptions.keyPrefix}:`
      : '';
    return `${prefix}conversation:${id}`;
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckTimer = setInterval(() => {
      this.ping().catch((err) => {
        console.error(
          '[RedisStore] Health check failed:',
          (err as Error).message
        );
      });
    }, HEALTH_CHECK_INTERVAL_MS);
    // Don't block process exit
    this.healthCheckTimer.unref();
  }

  /**
   * Stop health check timer
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Ping Redis to check connection
   */
  private async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Ensure client is available and connected
   */
  private ensureClient(): Redis {
    if (!this.client) {
      throw new Error('RedisStore not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * Calculate TTL in seconds from the record's expiresAt timestamp
   * Falls back to configured TTL if expiresAt is invalid
   */
  private calculateTtlSeconds(record: ConversationRecord): number {
    const now = Date.now();
    if (record.expiresAt && record.expiresAt > now) {
      return Math.floor((record.expiresAt - now) / 1000);
    }
    return this.redisOptions.ttlSeconds;
  }

  /**
   * Store a conversation record with TTL
   */
  async store(record: ConversationRecord): Promise<void> {
    const client = this.ensureClient();
    const key = this.getKey(record.id);
    const data = JSON.stringify(record);
    const ttl = this.calculateTtlSeconds(record);

    try {
      // Use SETEX for atomic set with TTL
      await client.setex(key, ttl, data);
    } catch (err) {
      console.error(
        `[RedisStore] Failed to store conversation ${record.id}:`,
        (err as Error).message
      );
      throw err;
    }
  }

  /**
   * Get a conversation by ID
   */
  async get(id: string): Promise<ConversationRecord | null> {
    const client = this.ensureClient();
    const key = this.getKey(id);

    try {
      const data = await client.get(key);
      if (!data) return null;

      const record = JSON.parse(data) as ConversationRecord;

      // Double-check expiration (Redis TTL handles this, but be safe)
      if (record.expiresAt && record.expiresAt < Date.now()) {
        // Record expired, delete it and return null
        await this.delete(id);
        return null;
      }

      return record;
    } catch (err) {
      console.error(
        `[RedisStore] Failed to get conversation ${id}:`,
        (err as Error).message
      );
      throw err;
    }
  }

  /**
   * Delete a conversation by ID
   */
  async delete(id: string): Promise<void> {
    const client = this.ensureClient();
    const key = this.getKey(id);

    try {
      await client.del(key);
    } catch (err) {
      console.error(
        `[RedisStore] Failed to delete conversation ${id}:`,
        (err as Error).message
      );
      throw err;
    }
  }

  /**
   * List all active (non-expired) conversation records
   * Note: SCAN is used for production safety (non-blocking)
   */
  async listActive(): Promise<ConversationRecord[]> {
    const client = this.ensureClient();
    const prefix = this.redisOptions.keyPrefix
      ? `${this.redisOptions.keyPrefix}:`
      : '';
    const pattern = `${prefix}conversation:*`;

    try {
      const records: ConversationRecord[] = [];
      let cursor = '0';

      // Use SCAN for production-safe iteration
      do {
        const [newCursor, keys] = await client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );
        cursor = newCursor;

        // Fetch all records in parallel using pipeline
        if (keys.length > 0) {
          const pipeline = client.pipeline();
          for (const key of keys) {
            pipeline.get(key);
          }
          const results = await pipeline.exec();

          if (results) {
            for (const [err, data] of results) {
              if (!err && data && typeof data === 'string') {
                try {
                  const record = JSON.parse(data) as ConversationRecord;
                  // Only include non-expired records
                  if (!record.expiresAt || record.expiresAt > Date.now()) {
                    records.push(record);
                  }
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }
        }
      } while (cursor !== '0');

      // Sort by createdAt descending (newest first)
      records.sort((a, b) => b.createdAt - a.createdAt);

      return records;
    } catch (err) {
      console.error(
        '[RedisStore] Failed to list conversations:',
        (err as Error).message
      );
      throw err;
    }
  }

  /**
   * Cleanup expired records
   * No-op for Redis since TTL handles expiration automatically
   * @returns 0 (Redis handles cleanup via TTL)
   */
  cleanup(): Promise<number> {
    // Redis handles TTL-based expiration automatically - no manual cleanup needed
    return Promise.resolve(0);
  }

  /**
   * Check if Redis connection is healthy
   * (Not part of interface, but useful for health checks)
   */
  async isHealthy(): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false;
    }
    return this.ping();
  }

  /**
   * Close Redis connection and clean up resources
   */
  async close(): Promise<void> {
    this.stopHealthCheck();

    if (this.client) {
      try {
        await this.client.quit();
        console.error('[RedisStore] Connection closed gracefully');
      } catch (err) {
        console.error(
          '[RedisStore] Error closing connection:',
          (err as Error).message
        );
        // Force disconnect if graceful quit fails
        this.client.disconnect();
      }
      this.client = null;
    }

    this.isConnected = false;
  }
}
