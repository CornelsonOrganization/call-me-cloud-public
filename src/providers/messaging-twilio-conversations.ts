/**
 * Twilio Conversations Provider
 *
 * Implements MessagingProvider using Twilio Conversations API for WhatsApp messaging.
 * Uses direct REST API calls (no SDK dependency).
 */

import {
  MessagingProvider,
  MessagingConfig,
  MessagingError,
  MessagingErrorCode,
} from './messaging-types';

interface ConversationState {
  createdAt: number;
  lastMessageAt: number;
}

export class TwilioConversationsProvider implements MessagingProvider {
  readonly name = 'twilio-conversations';

  private config!: MessagingConfig;
  private conversations = new Map<string, ConversationState>();

  initialize(config: MessagingConfig): void {
    if (!config.accountSid || !config.authToken) {
      throw new Error('Twilio Conversations: accountSid and authToken required');
    }

    if (!config.whatsappPhoneNumber) {
      throw new Error('Twilio Conversations: whatsappPhoneNumber required');
    }

    this.config = config;
    console.log(`[${this.name}] Initialized in ${config.whatsappMode} mode`);
  }

  /**
   * Create a new conversation with a WhatsApp user
   */
  async createConversation(userPhone: string): Promise<string> {
    // Ensure phone number has WhatsApp prefix
    const whatsappPhone = userPhone.startsWith('whatsapp:')
      ? userPhone
      : `whatsapp:${userPhone}`;

    try {
      // Step 1: Create conversation
      const conversationSid = await this.createConversationResource();

      // Step 2: Add user as participant
      await this.addParticipant(conversationSid, whatsappPhone);

      // Step 3: Add bot as participant
      await this.addParticipant(conversationSid, this.config.whatsappPhoneNumber);

      // Track conversation state
      this.conversations.set(conversationSid, {
        createdAt: Date.now(),
        lastMessageAt: Date.now(),
      });

      console.log(`[${this.name}] Created conversation ${conversationSid} for ${this.hashPhone(whatsappPhone)}`);

      return conversationSid;
    } catch (error: any) {
      console.error(`[${this.name}] Failed to create conversation:`, error);

      // Map Twilio errors to MessagingError
      if (error.code === 63015) {
        throw new MessagingError(
          MessagingErrorCode.OPT_IN_REQUIRED,
          `User needs to join WhatsApp sandbox by sending 'join ${this.config.whatsappSandboxCode}' to ${this.config.whatsappPhoneNumber}`,
          { twilioError: error }
        );
      }

      throw new MessagingError(
        MessagingErrorCode.UNKNOWN_ERROR,
        `Failed to create conversation: ${error.message}`,
        { twilioError: error }
      );
    }
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(
    conversationSid: string,
    body: string,
    useTemplate: boolean = false
  ): Promise<string> {
    try {
      // Check if session is still active (for WhatsApp 24-hour rule)
      const hasActiveSession = await this.hasActiveSession(conversationSid);

      if (!hasActiveSession && !useTemplate) {
        throw new MessagingError(
          MessagingErrorCode.TEMPLATE_REQUIRED,
          'WhatsApp 24-hour session window expired, template message required',
          { conversationSid }
        );
      }

      // Send message via Conversations API
      const url = `https://conversations.twilio.com/v1/Conversations/${conversationSid}/Messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          Author: this.config.whatsappPhoneNumber,
          Body: body,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Twilio API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const messageSid = data.sid;

      // Update conversation state
      const state = this.conversations.get(conversationSid);
      if (state) {
        state.lastMessageAt = Date.now();
      }

      console.log(`[${this.name}] Sent message ${messageSid} to conversation ${conversationSid}`);

      return messageSid;
    } catch (error: any) {
      console.error(`[${this.name}] Failed to send message:`, error);

      // Handle rate limiting
      if (error.code === 429 || error.status === 429) {
        throw new MessagingError(
          MessagingErrorCode.RATE_LIMIT_EXCEEDED,
          'Rate limit exceeded',
          { twilioError: error }
        );
      }

      // Handle opt-in required
      if (error.code === 63015) {
        throw new MessagingError(
          MessagingErrorCode.OPT_IN_REQUIRED,
          `User needs to join WhatsApp sandbox`,
          { twilioError: error }
        );
      }

      // Re-throw if already MessagingError
      if (error instanceof MessagingError) {
        throw error;
      }

      throw new MessagingError(
        MessagingErrorCode.UNKNOWN_ERROR,
        `Failed to send message: ${error.message}`,
        { twilioError: error }
      );
    }
  }

  /**
   * Check if conversation has active session window
   * For WhatsApp: 24 hours from last user message
   */
  async hasActiveSession(conversationSid: string): Promise<boolean> {
    const state = this.conversations.get(conversationSid);

    if (!state) {
      // Unknown conversation, assume expired
      return false;
    }

    // WhatsApp allows 24 hours from last message
    const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - state.lastMessageAt;

    return elapsed < SESSION_WINDOW_MS;
  }

  /**
   * Close a conversation
   */
  async closeConversation(conversationSid: string): Promise<void> {
    try {
      const url = `https://conversations.twilio.com/v1/Conversations/${conversationSid}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          State: 'closed',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${this.name}] Failed to close conversation ${conversationSid}: ${errorText}`);
        // Don't throw - closing is best-effort
      }

      // Remove from tracking
      this.conversations.delete(conversationSid);

      console.log(`[${this.name}] Closed conversation ${conversationSid}`);
    } catch (error) {
      console.error(`[${this.name}] Error closing conversation:`, error);
      // Don't throw - closing is best-effort
    }
  }

  /**
   * Create a conversation resource via Twilio API
   */
  private async createConversationResource(): Promise<string> {
    const url = 'https://conversations.twilio.com/v1/Conversations';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        FriendlyName: `Call-Me WhatsApp - ${Date.now()}`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create conversation: ${errorText}`);
    }

    const data = await response.json();
    return data.sid;
  }

  /**
   * Add a participant to a conversation
   */
  private async addParticipant(conversationSid: string, address: string): Promise<void> {
    const url = `https://conversations.twilio.com/v1/Conversations/${conversationSid}/Participants`;

    const params: any = {
      'MessagingBinding.Address': address,
    };

    // If this is a WhatsApp number, set the proxy address
    if (address.startsWith('whatsapp:')) {
      params['MessagingBinding.ProxyAddress'] = this.config.whatsappPhoneNumber;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add participant: ${errorText}`);
    }
  }

  /**
   * Hash phone number for logging (privacy)
   */
  private hashPhone(phone: string): string {
    // Simple hash for logging (not cryptographic)
    const hash = phone.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0);
    return `***${Math.abs(hash).toString(16)}`;
  }
}
