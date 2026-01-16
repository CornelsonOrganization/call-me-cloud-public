/**
 * Storage Module Entry Point
 *
 * Exports storage types, providers, and a factory function for creating
 * the appropriate storage provider based on configuration.
 */

export * from './types.js';
export { LocalFileStore } from './local-store.js';
export { RedisStore } from './redis-store.js';
export {
  ConversationService,
  getConversationService,
  closeConversationService,
  hashPhoneNumber,
} from './conversation-service.js';

import type { StorageProvider, StorageConfig } from './types.js';
import { LocalFileStore } from './local-store.js';
import { RedisStore } from './redis-store.js';

/**
 * Create and initialize a storage provider based on configuration.
 *
 * Provider selection priority:
 * 1. If config.type is 'redis' or REDIS_URL/CALLME_REDIS_URL env var exists → RedisStore
 * 2. Otherwise → LocalFileStore (default)
 *
 * @param config - Optional storage configuration
 * @returns Initialized storage provider
 *
 * @example
 * ```typescript
 * // Auto-detect (uses Redis if REDIS_URL is set, otherwise local file)
 * const storage = await createStorage();
 *
 * // Force local file storage
 * const localStorage = await createStorage({ type: 'local' });
 *
 * // Force Redis storage
 * const redisStorage = await createStorage({
 *   type: 'redis',
 *   connectionString: 'redis://localhost:6379'
 * });
 * ```
 */
export async function createStorage(config?: StorageConfig): Promise<StorageProvider> {
  const storageType = detectStorageType(config);

  let provider: StorageProvider;

  if (storageType === 'redis') {
    console.error('[Storage] Creating Redis storage provider');
    provider = new RedisStore(config);
  } else {
    console.error('[Storage] Creating local file storage provider');
    provider = new LocalFileStore();
  }

  await provider.initialize();
  return provider;
}

/**
 * Detect which storage type to use based on config and environment.
 */
function detectStorageType(config?: StorageConfig): 'redis' | 'local' {
  // Explicit type in config takes priority
  if (config?.type === 'redis') {
    return 'redis';
  }
  if (config?.type === 'local' || config?.type === 'memory') {
    return 'local';
  }

  // Check for Redis connection string in config
  if (config?.connectionString?.startsWith('redis')) {
    return 'redis';
  }

  // Check for Redis URL in environment
  const redisUrl = process.env.REDIS_URL || process.env.CALLME_REDIS_URL;
  if (redisUrl) {
    return 'redis';
  }

  // Default to local file storage
  return 'local';
}

/**
 * Singleton storage instance for the application.
 * Initialized lazily on first access.
 */
let storageInstance: StorageProvider | null = null;

/**
 * Get the global storage instance, creating it if necessary.
 * Uses auto-detection to choose the appropriate provider.
 *
 * @returns The global storage provider instance
 */
export async function getStorage(): Promise<StorageProvider> {
  if (!storageInstance) {
    storageInstance = await createStorage();
  }
  return storageInstance;
}

/**
 * Close the global storage instance.
 * Should be called during application shutdown.
 */
export async function closeStorage(): Promise<void> {
  if (storageInstance) {
    await storageInstance.close();
    storageInstance = null;
    console.error('[Storage] Global storage instance closed');
  }
}
