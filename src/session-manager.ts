/**
 * Session Manager - Secure session and phone mapping management
 *
 * Handles secure mapping between conversation SIDs and phone numbers.
 *
 * SECURITY: Phone numbers are NEVER stored in session state or logged.
 * They are stored separately in secure mappings that are:
 * - Never persisted to disk
 * - Never logged (only hashed versions are logged)
 * - Cleared when sessions end
 *
 * @warning DO NOT log phone numbers from these mappings
 * @warning DO NOT serialize these mappings to disk
 */

import type WebSocket from 'ws';
import type {
  ProviderRegistry,
  ProviderConfig,
  RealtimeSTTSession,
  MessagingProvider,
} from './providers/index.js';

export interface CallState {
  callId: string;
  callControlId: string | null;
  ws: WebSocket | null;
  streamSid: string | null;  // Twilio media stream ID (required for sending audio)
  streamingReady: boolean;  // True when streaming.started event received (Telnyx)
  wsToken: string;  // Security token for WebSocket authentication
  conversationHistory: Array<{ speaker: 'claude' | 'user'; message: string }>;
  startTime: number;
  hungUp: boolean;
  sttSession: RealtimeSTTSession | null;
  // Barge-in (interruption) state
  isSpeaking: boolean;  // True while TTS audio is being sent
  interrupted: boolean;  // True if user interrupted during TTS playback
  // WhatsApp fallback state
  contactMode: 'voice' | 'whatsapp';
  conversationSid?: string;         // Twilio Conversations SID
  whatsappSessionExpiry?: number;   // 24-hour session window timestamp
  pendingResponse: boolean;         // Waiting for user reply
  // Activity tracking (event-driven timeouts, no polling)
  lastActivityAt: number;           // Timestamp for inactivity timeout
  inactivityTimer?: NodeJS.Timeout; // Event-driven timeout (cleared on activity)
  whatsappSessionTimer?: NodeJS.Timeout; // 24-hour window timer
  hangupCheckInterval?: NodeJS.Timeout; // Interval for waitForHangup (cleaned up on session close)
  disconnectGraceTimer?: NodeJS.Timeout; // Grace period timer before marking as truly disconnected
}

export interface ServerConfig {
  publicUrl: string;
  port: number;
  phoneNumber: string;
  userPhoneNumber: string;
  providers: ProviderRegistry;
  providerConfig: ProviderConfig;  // For webhook signature verification
  transcriptTimeoutMs: number;
  inactivityTimeoutMs: number;  // Session inactivity timeout (default 7 minutes)
  messagingProvider: MessagingProvider | null;  // WhatsApp/messaging provider (optional, for fallback)
}

export class SessionManager {
  private sessions = new Map<string, CallState>();

  // Secure mappings (never logged, never persisted to disk)
  private conversationToPhone = new Map<string, string>();
  private phoneToConversation = new Map<string, string>();

  // Fast O(1) lookup by conversation SID (for webhook routing)
  private conversationToCallId = new Map<string, string>();

  constructor(private config: ServerConfig) {}

  /**
   * Register a phone number mapping for an existing call
   * Used when transitioning from voice to WhatsApp
   *
   * @warning NEVER log the phoneNumber parameter
   */
  registerPhoneMapping(callId: string, phoneNumber: string, conversationSid: string): void {
    const state = this.sessions.get(callId);
    if (!state) {
      throw new Error(`Cannot register phone mapping: call ${callId} not found`);
    }

    this.conversationToPhone.set(conversationSid, phoneNumber);
    this.phoneToConversation.set(phoneNumber, conversationSid);
    this.conversationToCallId.set(conversationSid, callId);  // For O(1) webhook routing

    console.error(`[${callId}] Phone mapping registered for conversation ${conversationSid} (phone hash: ${this.hashPhone(phoneNumber)})`);
  }

  /**
   * Get phone number for a conversation (used only when needed to initiate calls/messages)
   *
   * @warning NEVER log the returned value
   */
  getPhoneForConversation(conversationSid: string): string | undefined {
    return this.conversationToPhone.get(conversationSid);
  }

  /**
   * Get conversation SID for a phone number
   */
  getConversationForPhone(phoneNumber: string): string | undefined {
    return this.phoneToConversation.get(phoneNumber);
  }

  /**
   * Get session by call ID
   */
  getSession(callId: string): CallState | undefined {
    return this.sessions.get(callId);
  }

  /**
   * Get session by conversation SID (O(1) constant-time lookup)
   * Uses Map for fast lookup to prevent timing attacks
   */
  getSessionByConversation(conversationSid: string): CallState | undefined {
    const callId = this.conversationToCallId.get(conversationSid);
    if (!callId) {
      return undefined;
    }
    return this.sessions.get(callId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): Map<string, CallState> {
    return this.sessions;
  }

  /**
   * Add a session to management
   */
  addSession(callId: string, state: CallState): void {
    this.sessions.set(callId, state);
  }

  /**
   * Refresh inactivity timeout (call on every message received or sent)
   *
   * Uses event-driven timeout (no polling) for efficiency.
   * Timer is cleared and reset on every activity.
   */
  refreshInactivityTimeout(state: CallState): void {
    // Clear existing timer
    if (state.inactivityTimer) {
      clearTimeout(state.inactivityTimer);
    }

    // Set new timer
    state.inactivityTimer = setTimeout(() => {
      this.closeSession(state.callId, 'inactivity');
    }, this.config.inactivityTimeoutMs);

    // Update timestamp
    state.lastActivityAt = Date.now();
  }

  /**
   * Set WhatsApp 24-hour session window timer
   * Called once when user first replies to template message
   */
  setWhatsAppSessionTimer(state: CallState): void {
    if (!state.whatsappSessionExpiry) return;

    // Clear existing timer if already set (prevents dangling timers)
    if (state.whatsappSessionTimer) {
      clearTimeout(state.whatsappSessionTimer);
    }

    const timeUntilExpiry = state.whatsappSessionExpiry - Date.now();
    if (timeUntilExpiry <= 0) {
      console.error(`[${state.callId}] WhatsApp session window already expired`);
      return;
    }

    // Set timer for 1 hour before expiry (warning)
    const WARNING_TIME_MS = 60 * 60 * 1000; // 1 hour
    const warningTime = Math.max(0, timeUntilExpiry - WARNING_TIME_MS);

    state.whatsappSessionTimer = setTimeout(() => {
      this.handleSessionWindowExpiring(state);
    }, warningTime);

    console.error(`[${state.callId}] WhatsApp session window timer set, expires in ${Math.round(timeUntilExpiry / 1000 / 60)} minutes`);
  }

  /**
   * Handle WhatsApp session window expiring soon (1 hour warning)
   */
  private handleSessionWindowExpiring(state: CallState): void {
    console.error(`[${state.callId}] WhatsApp session window expiring soon (1 hour remaining)`, {
      conversationSid: state.conversationSid,
      expiresAt: state.whatsappSessionExpiry
    });

    // Set timer for actual expiry
    if (state.whatsappSessionExpiry) {
      const timeUntilExpiry = state.whatsappSessionExpiry - Date.now();
      if (timeUntilExpiry > 0) {
        state.whatsappSessionTimer = setTimeout(() => {
          this.handleSessionWindowExpired(state);
        }, timeUntilExpiry);
      }
    }
  }

  /**
   * Handle WhatsApp session window fully expired
   */
  private handleSessionWindowExpired(state: CallState): void {
    console.error(`[${state.callId}] WhatsApp session window expired`, {
      conversationSid: state.conversationSid
    });

    // Mark as expired (next message requires template)
    state.whatsappSessionExpiry = undefined;
  }

  /**
   * Close session with reason
   */
  closeSession(callId: string, reason: string): void {
    const state = this.sessions.get(callId);
    if (!state) return;

    console.error(`[${callId}] Closing session (reason: ${reason}, mode: ${state.contactMode})`);

    // Clean up
    this.removeSession(callId);
  }

  /**
   * Remove session and clean up all associated resources
   */
  removeSession(callId: string): void {
    const state = this.sessions.get(callId);
    if (!state) return;

    // Clear timers
    if (state.inactivityTimer) {
      clearTimeout(state.inactivityTimer);
      state.inactivityTimer = undefined;
    }
    if (state.whatsappSessionTimer) {
      clearTimeout(state.whatsappSessionTimer);
      state.whatsappSessionTimer = undefined;
    }
    if (state.hangupCheckInterval) {
      clearInterval(state.hangupCheckInterval);
      state.hangupCheckInterval = undefined;
    }
    if (state.disconnectGraceTimer) {
      clearTimeout(state.disconnectGraceTimer);
      state.disconnectGraceTimer = undefined;
    }

    // Remove secure phone mappings
    if (state.conversationSid) {
      const phone = this.conversationToPhone.get(state.conversationSid);
      if (phone) {
        this.phoneToConversation.delete(phone);
      }
      this.conversationToPhone.delete(state.conversationSid);
      this.conversationToCallId.delete(state.conversationSid);  // Clean up O(1) lookup map
    }

    // Remove session
    this.sessions.delete(callId);

    console.error(`[${callId}] Session removed and cleaned up`);
  }

  /**
   * Hash phone number for logging (privacy)
   * Uses same simple hash as TwilioConversationsProvider
   *
   * @warning Only use for logging, not for security
   */
  private hashPhone(phone: string): string {
    const hash = phone.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0);
    return `***${Math.abs(hash).toString(16)}`;
  }
}
