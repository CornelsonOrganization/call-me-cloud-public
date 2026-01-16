/**
 * Local File Storage Provider
 *
 * Implements the StorageProvider interface using the local filesystem.
 * Stores each conversation as a separate JSON file with atomic writes.
 *
 * Features:
 * - Atomic file writes (write to temp, then rename)
 * - Automatic TTL-based cleanup every 5 minutes
 * - Handles concurrent access gracefully
 * - No external dependencies (uses Node.js fs/promises)
 */

import { mkdir, readFile, writeFile, unlink, readdir, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type {
  StorageProvider,
  StorageConfig,
  ConversationRecord,
} from './types.js';

/** Default data directory for storing conversation files */
const DEFAULT_DATA_DIR = '.data/conversations';

/** Default cleanup interval: 5 minutes */
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Local file-based storage provider.
 * Each conversation is stored as {id}.json in the configured directory.
 */
export class LocalFileStore implements StorageProvider {
  private dataDir: string = DEFAULT_DATA_DIR;
  private cleanupIntervalMs: number = DEFAULT_CLEANUP_INTERVAL_MS;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  /**
   * Initialize the storage provider.
   * Creates the data directory if it doesn't exist and starts the cleanup interval.
   */
  async initialize(config?: StorageConfig): Promise<void> {
    if (this.initialized) {
      console.error('[LocalFileStore] Already initialized');
      return;
    }

    // Apply configuration
    if (config?.filePath) {
      this.dataDir = config.filePath;
    }
    if (config?.cleanupIntervalMs) {
      this.cleanupIntervalMs = config.cleanupIntervalMs;
    }

    // Ensure data directory exists
    try {
      await mkdir(this.dataDir, { recursive: true });
      console.error(`[LocalFileStore] Initialized with data directory: ${this.dataDir}`);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // Directory already exists is fine
      if (err.code !== 'EEXIST') {
        throw new Error(`Failed to create data directory: ${err.message}`);
      }
    }

    // Start automatic cleanup if enabled (default: true)
    if (config?.autoCleanup !== false) {
      this.startCleanupInterval();
    }

    this.initialized = true;
  }

  /**
   * Start the periodic cleanup interval.
   * Runs cleanup every 5 minutes (configurable) to remove expired records.
   */
  private startCleanupInterval(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      void this.cleanup().then((count) => {
        if (count > 0) {
          console.error(`[LocalFileStore] Cleanup removed ${count} expired records`);
        }
      }).catch((error) => {
        console.error('[LocalFileStore] Cleanup error:', error);
      });
    }, this.cleanupIntervalMs);

    // Don't block process exit
    this.cleanupTimer.unref();

    console.error(`[LocalFileStore] Started cleanup interval (every ${this.cleanupIntervalMs / 1000}s)`);
  }

  /**
   * Store a conversation record.
   * Uses atomic write (temp file + rename) to prevent corruption.
   */
  async store(record: ConversationRecord): Promise<void> {
    this.ensureInitialized();

    const filePath = this.getFilePath(record.id);
    const tempPath = this.getTempFilePath(record.id);

    try {
      // Ensure parent directory exists (in case of nested IDs)
      await mkdir(dirname(filePath), { recursive: true });

      // Write to temp file first
      const data = JSON.stringify(record);
      await writeFile(tempPath, data, 'utf8');

      // Atomically rename temp file to final path
      await rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Retrieve a conversation record by ID.
   * Returns null if not found or expired.
   */
  async get(id: string): Promise<ConversationRecord | null> {
    this.ensureInitialized();

    const filePath = this.getFilePath(id);

    try {
      const data = await readFile(filePath, 'utf8');
      const record = JSON.parse(data) as ConversationRecord;

      // Check if expired
      if (record.expiresAt && Date.now() > record.expiresAt) {
        console.error(`[LocalFileStore] Record ${id} has expired, returning null`);
        // Optionally delete the expired file (lazy cleanup)
        this.delete(id).catch(() => {
          // Ignore delete errors during lazy cleanup
        });
        return null;
      }

      return record;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        // File doesn't exist
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete a conversation record by ID.
   * No-op if the record does not exist.
   */
  async delete(id: string): Promise<void> {
    this.ensureInitialized();

    const filePath = this.getFilePath(id);

    try {
      await unlink(filePath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        // File doesn't exist, which is fine
        return;
      }
      throw error;
    }
  }

  /**
   * List all active (non-expired) conversation records.
   * Returns records sorted by createdAt descending (newest first).
   */
  async listActive(): Promise<ConversationRecord[]> {
    this.ensureInitialized();

    const records: ConversationRecord[] = [];
    const now = Date.now();

    try {
      const files = await readdir(this.dataDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const id = file.slice(0, -5); // Remove .json extension
        const record = await this.get(id);

        if (record && (!record.expiresAt || record.expiresAt > now)) {
          records.push(record);
        }
      }

      // Sort by createdAt descending (newest first)
      records.sort((a, b) => b.createdAt - a.createdAt);

      return records;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        // Directory doesn't exist yet
        return [];
      }
      throw error;
    }
  }

  /**
   * Remove all expired records from storage.
   * Scans all files and deletes those where expiresAt < now.
   *
   * @returns The number of records that were removed
   */
  async cleanup(): Promise<number> {
    this.ensureInitialized();

    let removedCount = 0;
    const now = Date.now();

    try {
      const files = await readdir(this.dataDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = join(this.dataDir, file);

        try {
          const data = await readFile(filePath, 'utf8');
          const record = JSON.parse(data) as ConversationRecord;

          if (record.expiresAt && record.expiresAt < now) {
            await unlink(filePath);
            removedCount++;
            console.error(`[LocalFileStore] Cleaned up expired record: ${record.id}`);
          }
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          // Skip files that can't be read (might be temp files or corrupted)
          if (err.code !== 'ENOENT') {
            console.error(`[LocalFileStore] Error processing ${file} during cleanup:`, error);
          }
        }
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        // Directory doesn't exist yet, nothing to clean
        return 0;
      }
      throw error;
    }

    return removedCount;
  }

  /**
   * Gracefully close the storage provider.
   * Stops the cleanup interval.
   */
  close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.error('[LocalFileStore] Stopped cleanup interval');
    }

    this.initialized = false;
    console.error('[LocalFileStore] Closed');
    return Promise.resolve();
  }

  /**
   * Get the file path for a conversation record.
   * Sanitizes the ID to prevent path traversal attacks.
   */
  private getFilePath(id: string): string {
    const sanitizedId = this.sanitizeId(id);
    return join(this.dataDir, `${sanitizedId}.json`);
  }

  /**
   * Get a temporary file path for atomic writes.
   */
  private getTempFilePath(id: string): string {
    const sanitizedId = this.sanitizeId(id);
    const uniqueSuffix = randomUUID().slice(0, 8);
    return join(this.dataDir, `.${sanitizedId}.${uniqueSuffix}.tmp`);
  }

  /**
   * Sanitize an ID to prevent path traversal attacks.
   * Replaces dangerous characters with underscores.
   */
  private sanitizeId(id: string): string {
    // Replace any path separators, null bytes, and other dangerous characters
    return id.replace(/[/\\:\0<>"|?*]/g, '_');
  }

  /**
   * Ensure the provider has been initialized.
   * Throws if initialize() has not been called.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('LocalFileStore not initialized. Call initialize() first.');
    }
  }
}
