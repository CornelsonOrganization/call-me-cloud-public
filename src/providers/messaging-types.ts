/**
 * Messaging Provider Types
 *
 * Abstractions for messaging services (WhatsApp, SMS, Teams, Signal, etc.)
 * This interface supports multi-channel messaging with templates and session windows.
 */

/**
 * Messaging Provider interface
 *
 * Provides abstraction over messaging services like WhatsApp, Teams, and Signal.
 * Each provider handles conversation creation, message sending, and lifecycle management.
 */
export interface MessagingProvider {
  readonly name: string;

  /**
   * Initialize the provider with configuration
   */
  initialize(config: MessagingConfig): void;

  /**
   * Create a new conversation with a user
   * @param userPhone User's phone number (E.164 format with channel prefix, e.g., "whatsapp:+14155551234")
   * @returns Conversation SID from provider
   */
  createConversation(userPhone: string): Promise<string>;

  /**
   * Send a message in a conversation
   * @param conversationSid The conversation identifier
   * @param body Message text
   * @param useTemplate Whether to use approved template (for business-initiated messages)
   * @returns Message SID
   */
  sendMessage(
    conversationSid: string,
    body: string,
    useTemplate?: boolean
  ): Promise<string>;

  /**
   * Check if conversation has active session window (within 24 hours for WhatsApp)
   * @param conversationSid The conversation identifier
   * @returns true if session is active, false if expired
   */
  hasActiveSession(conversationSid: string): Promise<boolean>;

  /**
   * Close a conversation
   * @param conversationSid The conversation identifier
   */
  closeConversation(conversationSid: string): Promise<void>;
}

/**
 * Messaging configuration
 */
export interface MessagingConfig {
  accountSid: string;
  authToken: string;

  // WhatsApp-specific
  whatsappPhoneNumber: string;  // e.g., "whatsapp:+14155238886"
  whatsappMode: 'sandbox' | 'production';
  whatsappSandboxCode?: string; // Join code for sandbox

  // Future extensibility
  teamsWebhookUrl?: string;
  signalNumber?: string;
}

/**
 * Messaging error codes
 */
export enum MessagingErrorCode {
  OPT_IN_REQUIRED = 'whatsapp_opt_in_required',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  TEMPLATE_REQUIRED = 'template_required',
  INVALID_NUMBER = 'invalid_number',
  NETWORK_ERROR = 'network_error',
  UNKNOWN_ERROR = 'unknown_error',
}

/**
 * Messaging error
 */
export class MessagingError extends Error {
  constructor(
    public code: MessagingErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MessagingError';
  }
}
