/**
 * Conversation Persistence Service
 *
 * Bridges the session manager with the storage layer.
 * Handles conversion of call session data to storage format and
 * automatic persistence when sessions end.
 *
 * Privacy features:
 * - Phone numbers are hashed before storage
 * - No PII is logged
 * - Automatic TTL-based expiration (2 days)
 */

import { createHash } from 'crypto';
import type { CallState } from '../session-manager.js';
import type {
  StorageProvider,
  ConversationRecord,
  ConversationMessage,
} from './types.js';
import { getStorage, closeStorage } from './index.js';
import { DEFAULT_TTL_MS } from './types.js';

/**
 * Hash a phone number for privacy.
 * Uses SHA-256 truncated to 16 chars for reasonable collision resistance.
 *
 * @param phoneNumber - Raw phone number (e.g., +15551234567)
 * @returns Hashed phone number (e.g., "a1b2c3d4e5f6g7h8")
 */
export function hashPhoneNumber(phoneNumber: string): string {
  return createHash('sha256')
    .update(phoneNumber)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Conversation persistence service.
 * Handles storing and retrieving conversation records.
 */
export class ConversationService {
  private storage: StorageProvider | null = null;
  private initialized = false;

  /**
   * Initialize the conversation service.
   * Creates the appropriate storage provider based on configuration.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.storage = await getStorage();
    this.initialized = true;
    console.error('[ConversationService] Initialized');
  }

  /**
   * Persist a call session's conversation history.
   *
   * @param state - The call state containing conversation history
   * @param phoneNumber - Raw phone number (will be hashed before storage)
   * @returns The stored conversation record, or null if storage failed
   */
  async persistConversation(
    state: CallState,
    phoneNumber: string
  ): Promise<ConversationRecord | null> {
    if (!this.storage) {
      console.error('[ConversationService] Cannot persist: not initialized');
      return null;
    }

    // Skip if no conversation history
    if (!state.conversationHistory || state.conversationHistory.length === 0) {
      console.error(`[${state.callId}] No conversation history to persist`);
      return null;
    }

    const now = Date.now();

    // Convert conversation history to storage format
    const messages: ConversationMessage[] = state.conversationHistory.map(
      (entry, index) => ({
        speaker: entry.speaker,
        message: entry.message,
        // Approximate timestamp based on start time + offset
        // More accurate timestamps would require tracking per-message
        timestamp: state.startTime + index * 1000,
      })
    );

    const record: ConversationRecord = {
      id: state.callId,
      phoneNumber: hashPhoneNumber(phoneNumber),
      contactMode: state.contactMode || 'voice',
      messages,
      createdAt: state.startTime,
      expiresAt: now + DEFAULT_TTL_MS,
      metadata: {
        durationSeconds: Math.round((now - state.startTime) / 1000),
        messageCount: messages.length,
        conversationSid: state.conversationSid,
      },
    };

    try {
      await this.storage.store(record);
      console.error(
        `[${state.callId}] Conversation persisted (${messages.length} messages, mode: ${state.contactMode})`
      );
      return record;
    } catch (error) {
      console.error(`[${state.callId}] Failed to persist conversation:`, error);
      return null;
    }
  }

  /**
   * Add a message to an existing conversation record.
   * Used for ongoing WhatsApp conversations.
   *
   * @param callId - The call/conversation ID
   * @param speaker - Who sent the message ('user' or 'assistant')
   * @param message - The message content
   */
  async addMessage(
    callId: string,
    speaker: string,
    message: string
  ): Promise<void> {
    if (!this.storage) {
      console.error('[ConversationService] Cannot add message: not initialized');
      return;
    }

    const existing = await this.storage.get(callId);
    if (!existing) {
      console.error(`[${callId}] Cannot add message: conversation not found`);
      return;
    }

    existing.messages.push({
      speaker,
      message,
      timestamp: Date.now(),
    });

    // Update expiration (extend TTL from now)
    existing.expiresAt = Date.now() + DEFAULT_TTL_MS;

    try {
      await this.storage.store(existing);
      console.error(`[${callId}] Message added to conversation`);
    } catch (error) {
      console.error(`[${callId}] Failed to add message:`, error);
    }
  }

  /**
   * Get a conversation record by ID.
   *
   * @param callId - The call/conversation ID
   * @returns The conversation record, or null if not found
   */
  async getConversation(callId: string): Promise<ConversationRecord | null> {
    if (!this.storage) {
      console.error('[ConversationService] Cannot get: not initialized');
      return null;
    }

    return this.storage.get(callId);
  }

  /**
   * List all active conversations.
   *
   * @returns Array of active conversation records
   */
  async listActiveConversations(): Promise<ConversationRecord[]> {
    if (!this.storage) {
      console.error('[ConversationService] Cannot list: not initialized');
      return [];
    }

    return this.storage.listActive();
  }

  /**
   * Close the conversation service and storage.
   */
  async close(): Promise<void> {
    if (this.storage) {
      await closeStorage();
      this.storage = null;
      this.initialized = false;
      console.error('[ConversationService] Closed');
    }
  }
}

// Singleton instance
let conversationServiceInstance: ConversationService | null = null;

/**
 * Get the global conversation service instance.
 * Creates and initializes it if necessary.
 */
export async function getConversationService(): Promise<ConversationService> {
  if (!conversationServiceInstance) {
    conversationServiceInstance = new ConversationService();
    await conversationServiceInstance.initialize();
  }
  return conversationServiceInstance;
}

/**
 * Close the global conversation service instance.
 */
export async function closeConversationService(): Promise<void> {
  if (conversationServiceInstance) {
    await conversationServiceInstance.close();
    conversationServiceInstance = null;
  }
}
