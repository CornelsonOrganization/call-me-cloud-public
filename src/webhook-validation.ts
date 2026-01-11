/**
 * Webhook Input Validation - Sanitize and validate incoming WhatsApp messages
 *
 * SECURITY: Critical defense against injection attacks and malformed payloads
 *
 * Validates:
 * - Required fields present
 * - Message length within limits
 * - Conversation SID format
 * - Phone number format
 * - Control characters removed
 */

export interface ValidationResult {
  valid: boolean;
  sanitized?: string;
  error?: string;
}

/**
 * Validate incoming WhatsApp message from Twilio Conversations webhook
 *
 * SECURITY CHECKS:
 * 1. Required fields present
 * 2. Message length (prevent DoS via huge messages)
 * 3. Empty message detection
 * 4. Control character removal (prevent injection)
 * 5. Conversation SID format validation
 * 6. Author (phone number) format validation
 *
 * @param body Parsed webhook body from Twilio Conversations
 * @returns ValidationResult with sanitized message or error
 */
export function validateWhatsAppMessage(body: any): ValidationResult {
  // 1. Check required fields
  if (!body.ConversationSid || !body.Author || body.Body === undefined) {
    return {
      valid: false,
      error: 'Missing required fields'
    };
  }

  const messageText = String(body.Body);

  // 2. Length validation (64KB max - prevent DoS)
  const MAX_MESSAGE_LENGTH = 65536;
  if (messageText.length > MAX_MESSAGE_LENGTH) {
    return {
      valid: false,
      error: 'Message too long'
    };
  }

  // 3. Check for empty message after trimming
  if (messageText.trim().length === 0) {
    return {
      valid: false,
      error: 'Empty message'
    };
  }

  // 4. Remove control characters (except newline, tab, carriage return)
  // This prevents injection attacks via control characters
  const sanitized = messageText.replace(
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
    ''
  );

  // 5. Validate conversation/message SID format
  // Accept both ConversationSid (CH...) and MessageSid (SM.../IM...) formats
  if (!isValidConversationSid(body.ConversationSid) && !isValidMessageSid(body.ConversationSid)) {
    return {
      valid: false,
      error: 'Invalid conversation/message SID format'
    };
  }

  // 6. Validate author format (whatsapp:+1234567890)
  if (!isValidWhatsAppNumber(body.Author)) {
    return {
      valid: false,
      error: 'Invalid author format'
    };
  }

  return {
    valid: true,
    sanitized
  };
}

/**
 * Validate Twilio Conversations SID format
 *
 * Format: CH followed by 32 hexadecimal characters
 * Example: CH01234567890123456789012345678901
 *
 * SECURITY: Prevents injection via malformed SIDs
 */
export function isValidConversationSid(sid: string): boolean {
  return /^CH[0-9a-f]{32}$/i.test(sid);
}

/**
 * Validate Twilio Message SID format
 *
 * Format: SM or IM followed by 32 hexadecimal characters
 * Examples: SM01234567890123456789012345678901
 *           IM01234567890123456789012345678901
 *
 * SECURITY: Prevents injection via malformed SIDs
 */
export function isValidMessageSid(sid: string): boolean {
  return /^(SM|IM|MM)[0-9a-f]{32}$/i.test(sid);
}

/**
 * Validate WhatsApp number format
 *
 * Format: whatsapp:+[country code][number]
 * - Must start with "whatsapp:"
 * - Must have E.164 format: + followed by 7-15 digits
 * - First digit cannot be 0 (no country code starts with 0)
 *
 * Examples:
 * - Valid: "whatsapp:+14155551234"
 * - Invalid: "whatsapp:+0123456789" (starts with 0)
 * - Invalid: "whatsapp:123456" (missing +)
 * - Invalid: "+14155551234" (missing whatsapp: prefix)
 *
 * SECURITY: Prevents injection via malformed phone numbers
 */
export function isValidWhatsAppNumber(number: string): boolean {
  return /^whatsapp:\+[1-9]\d{6,14}$/.test(number);
}

/**
 * Hash a value for privacy-safe logging
 *
 * Uses simple hash for logging identifiers without exposing sensitive data.
 * NOT cryptographically secure - only for logging/debugging.
 *
 * @warning Do not use for security purposes
 */
export function hashForLogging(value: string): string {
  const hash = value.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  return `***${Math.abs(hash).toString(16)}`;
}
