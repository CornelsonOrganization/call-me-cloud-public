/**
 * Storage Types for Call-Me Cloud Persistence Layer
 *
 * This module defines the interfaces for persisting conversation records
 * to enable conversation history, analytics, and recovery features.
 */

/**
 * Represents a single message within a conversation.
 * Captures who spoke, what was said, and when.
 */
export interface ConversationMessage {
  /** The speaker identifier - typically 'assistant' or 'user' */
  speaker: string;
  /** The content of the message */
  message: string;
  /** Unix timestamp in milliseconds when the message was recorded */
  timestamp: number;
}

/**
 * A complete conversation record containing all messages and metadata.
 * Stored with a TTL (time-to-live) for automatic expiration after 2 days.
 */
export interface ConversationRecord {
  /** Unique identifier for the conversation (typically the call ID) */
  id: string;

  /**
   * Phone number associated with the conversation.
   * Should be hashed for privacy before storage.
   */
  phoneNumber: string;

  /** The communication channel used for this conversation */
  contactMode: 'voice' | 'whatsapp';

  /** Ordered array of messages exchanged during the conversation */
  messages: ConversationMessage[];

  /** Unix timestamp in milliseconds when the conversation was created */
  createdAt: number;

  /**
   * Unix timestamp in milliseconds when this record should expire.
   * Typically set to 2 days (172800000 ms) after createdAt.
   * Storage providers should automatically clean up expired records.
   */
  expiresAt: number;

  /**
   * Optional metadata for storing additional conversation context.
   * Can include call duration, error states, provider-specific data, etc.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration options for initializing a storage provider.
 * Different providers may require different configuration fields.
 */
export interface StorageConfig {
  /**
   * The type of storage backend to use.
   * Examples: 'memory', 'redis', 'sqlite', 'postgres'
   */
  type?: string;

  /**
   * Connection string for database-backed storage providers.
   * Format depends on the provider (e.g., redis://localhost:6379)
   */
  connectionString?: string;

  /**
   * File path for file-based storage providers (e.g., SQLite).
   */
  filePath?: string;

  /**
   * Default TTL in milliseconds for conversation records.
   * Defaults to 2 days (172800000 ms) if not specified.
   */
  defaultTtlMs?: number;

  /**
   * Maximum number of records to retain.
   * When exceeded, oldest records are removed first.
   */
  maxRecords?: number;

  /**
   * Whether to enable automatic cleanup of expired records.
   * If enabled, the provider should periodically run cleanup().
   */
  autoCleanup?: boolean;

  /**
   * Interval in milliseconds between automatic cleanup runs.
   * Only used if autoCleanup is true.
   */
  cleanupIntervalMs?: number;

  /**
   * Additional provider-specific configuration options.
   */
  options?: Record<string, unknown>;
}

/**
 * Interface that all storage providers must implement.
 * Provides CRUD operations for conversation records with TTL support.
 *
 * @example
 * ```typescript
 * const storage: StorageProvider = new MemoryStorageProvider();
 * await storage.initialize();
 *
 * await storage.store({
 *   id: 'call-123',
 *   phoneNumber: hashPhone('+15551234567'),
 *   contactMode: 'voice',
 *   messages: [],
 *   createdAt: Date.now(),
 *   expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000, // 2 days
 * });
 *
 * const record = await storage.get('call-123');
 * await storage.close();
 * ```
 */
export interface StorageProvider {
  /**
   * Initialize the storage provider.
   * Must be called before any other operations.
   * Establishes connections, creates tables/indexes, etc.
   *
   * @throws Error if initialization fails (e.g., connection refused)
   */
  initialize(): Promise<void>;

  /**
   * Store a conversation record.
   * If a record with the same ID exists, it should be overwritten.
   *
   * @param record - The conversation record to store
   * @throws Error if storage operation fails
   */
  store(record: ConversationRecord): Promise<void>;

  /**
   * Retrieve a conversation record by ID.
   * Returns null if the record does not exist or has expired.
   *
   * @param id - The unique identifier of the conversation
   * @returns The conversation record, or null if not found/expired
   */
  get(id: string): Promise<ConversationRecord | null>;

  /**
   * Delete a conversation record by ID.
   * No-op if the record does not exist.
   *
   * @param id - The unique identifier of the conversation to delete
   */
  delete(id: string): Promise<void>;

  /**
   * List all active (non-expired) conversation records.
   * Results are typically ordered by createdAt descending (newest first).
   *
   * @returns Array of active conversation records
   */
  listActive(): Promise<ConversationRecord[]>;

  /**
   * Remove all expired records from storage.
   * Should be called periodically to free up storage space.
   *
   * @returns The number of records that were removed
   */
  cleanup(): Promise<number>;

  /**
   * Gracefully close the storage provider.
   * Releases connections, flushes pending writes, etc.
   * The provider should not be used after close() is called.
   */
  close(): Promise<void>;
}

/**
 * Default TTL for conversation records: 2 days in milliseconds.
 */
export const DEFAULT_TTL_MS = 2 * 24 * 60 * 60 * 1000; // 172800000 ms

/**
 * Utility function to calculate expiration timestamp from creation time.
 *
 * @param createdAt - Unix timestamp in milliseconds when the record was created
 * @param ttlMs - Time-to-live in milliseconds (defaults to DEFAULT_TTL_MS)
 * @returns Unix timestamp in milliseconds when the record should expire
 */
export function calculateExpiresAt(
  createdAt: number,
  ttlMs: number = DEFAULT_TTL_MS
): number {
  return createdAt + ttlMs;
}
