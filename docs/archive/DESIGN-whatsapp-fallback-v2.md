# WhatsApp Fallback Design (v2 - Security Hardened)

## Overview

Add WhatsApp fallback behavior to the call-me system. When a user doesn't answer a call, the system automatically falls back to WhatsApp messaging using Twilio's Conversations API. The session maintains continuity between voice and messaging modalities with end-to-end encryption.

**Version 2 Changes:**
- ✅ Explicit webhook signature validation implementation
- ✅ Uniform response handling to prevent session enumeration
- ✅ Phone number storage moved out of session state
- ✅ Comprehensive rate limiting specification
- ✅ Event-driven session timeouts (no polling)
- ✅ Restrictive keyword detection patterns
- ✅ Input validation for all incoming messages

## Architecture Decisions

**Key decisions made:**
1. **Messaging API**: Twilio Conversations API (multi-channel, conversation history, future extensibility)
2. **Fallback chain**: Voice → WhatsApp only (no SMS, WhatsApp provides encryption)
3. **WhatsApp mode**: Sandbox mode (simplifies testing, no Meta Business Manager required)
4. **Provider abstraction**: Create unified messaging provider interface for future Teams/Signal support
5. **Templates**: Use pre-approved sandbox templates initially, document production template requirements
6. **Security-first**: All critical security issues addressed with specific implementations

## User Flow

```
Claude Code initiates contact
    ↓
Try calling user (ring for ~25 seconds)
    ↓
User answers? ──YES──→ Voice conversation continues normally
    │
    NO (no answer / declined)
    ↓
Send WhatsApp message using pre-approved template
    ↓
User replies via WhatsApp (opens 24-hour session window)
    ↓
Check for "call me" keyword? ──YES──→ Try calling again
    │
    NO
    ↓
Continue conversation via WhatsApp (freeform messages within 24h window)
    ↓
7-minute inactivity? ──YES──→ Session closes, user returns to Claude Code manually
    │
    NO
    ↓
(loop back to "User replies via WhatsApp")
```

## Design Details

### 1. Call Timeout & WhatsApp Fallback

**Behavior:**
- Initiate call as normal
- Wait ~25 seconds for user to answer
- If call goes to voicemail or is declined, send WhatsApp template message
- Transition session to "WhatsApp mode"

**Implementation:**
- Add `CallStatus` type: `'ringing' | 'answered' | 'declined' | 'no-answer' | 'voicemail'`
- Detect call outcome via Twilio webhook status callbacks:
  - `answered` → proceed with voice
  - `no-answer` / `busy` / `canceled` / `failed` → trigger WhatsApp fallback
- Create new `MessagingProvider` interface with Twilio Conversations implementation
- Store `contactMode: 'voice' | 'whatsapp'` in session state

**WhatsApp-specific requirements:**
- User must have joined sandbox (send "join <sandbox-code>" to sandbox number)
- Initial message uses pre-approved template (e.g., appointment reminder adapted)
- After user replies, get 24-hour window for freeform messaging

---

### 2. Session State (SECURITY HARDENED)

**CRITICAL CHANGE:** Phone numbers are NO LONGER stored in session state.

**New session state structure:**

```typescript
interface SessionState {
  // Existing fields
  sessionId: string;
  callId: string;
  callControlId: string | null;
  ws: WebSocket | null;

  // New fields
  contactMode: 'voice' | 'whatsapp';
  conversationSid?: string;         // Twilio Conversations SID
  whatsappSessionExpiry?: number;   // 24-hour session window timestamp
  pendingResponse: boolean;         // Waiting for user reply

  // Activity tracking
  lastActivityAt: number;           // Timestamp for inactivity timeout
  inactivityTimer?: NodeJS.Timeout; // Event-driven timeout (no polling)
  whatsappSessionTimer?: NodeJS.Timeout; // 24-hour window timer

  // NOTE: phoneNumber removed - see SessionManager below
}
```

**Separate Phone Number Mapping (SECURE):**

```typescript
/**
 * SessionManager handles secure mapping between conversation SIDs and phone numbers.
 * Phone numbers are NEVER stored in session state or logged.
 */
class SessionManager {
  private sessions = new Map<string, SessionState>();

  // Secure mappings (never logged, never persisted to disk)
  private conversationToPhone = new Map<string, string>();
  private phoneToConversation = new Map<string, string>();

  /**
   * Create a new session with secure phone number mapping
   */
  createSession(sessionId: string, phoneNumber: string, conversationSid: string): SessionState {
    const session: SessionState = {
      sessionId,
      callId: generateCallId(),
      callControlId: null,
      ws: null,
      contactMode: 'whatsapp',
      conversationSid,
      whatsappSessionExpiry: Date.now() + (24 * 60 * 60 * 1000),
      pendingResponse: true,
      lastActivityAt: Date.now(),
    };

    // Store session
    this.sessions.set(sessionId, session);

    // Store secure phone mapping (never in session state)
    this.conversationToPhone.set(conversationSid, phoneNumber);
    this.phoneToConversation.set(phoneNumber, conversationSid);

    // Set up event-driven timeouts
    this.refreshInactivityTimeout(session);
    this.setWhatsAppSessionTimer(session);

    return session;
  }

  /**
   * Get phone number for a conversation (used only when needed)
   * NEVER log the returned value
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
   * Clean up session and secure mappings
   */
  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Clear timers
      if (session.inactivityTimer) clearTimeout(session.inactivityTimer);
      if (session.whatsappSessionTimer) clearTimeout(session.whatsappSessionTimer);

      // Remove secure mappings
      if (session.conversationSid) {
        const phone = this.conversationToPhone.get(session.conversationSid);
        if (phone) {
          this.phoneToConversation.delete(phone);
        }
        this.conversationToPhone.delete(session.conversationSid);
      }

      // Remove session
      this.sessions.delete(sessionId);
    }
  }

  // ... timeout methods below ...
}
```

---

### 3. Event-Driven Session Timeouts (NO POLLING)

**CRITICAL CHANGE:** Replace polling with event-driven timeouts using `setTimeout`.

```typescript
class SessionManager {
  /**
   * Refresh inactivity timeout (7 minutes)
   * Called on every message received or sent
   */
  refreshInactivityTimeout(session: SessionState): void {
    // Clear existing timer
    if (session.inactivityTimer) {
      clearTimeout(session.inactivityTimer);
    }

    // Set new timer
    const INACTIVITY_TIMEOUT_MS = 7 * 60 * 1000; // 7 minutes
    session.inactivityTimer = setTimeout(() => {
      this.closeSession(session.sessionId, 'inactivity');
    }, INACTIVITY_TIMEOUT_MS);

    // Update timestamp
    session.lastActivityAt = Date.now();
  }

  /**
   * Set WhatsApp 24-hour session window timer
   * Called once when user first replies
   */
  setWhatsAppSessionTimer(session: SessionState): void {
    if (!session.whatsappSessionExpiry) return;

    const timeUntilExpiry = session.whatsappSessionExpiry - Date.now();
    if (timeUntilExpiry <= 0) return; // Already expired

    // Set timer for 1 hour before expiry (warning)
    const WARNING_TIME_MS = 60 * 60 * 1000; // 1 hour
    const warningTime = Math.max(0, timeUntilExpiry - WARNING_TIME_MS);

    session.whatsappSessionTimer = setTimeout(() => {
      this.handleSessionWindowExpiring(session);
    }, warningTime);
  }

  /**
   * Handle WhatsApp session window expiring soon
   */
  private handleSessionWindowExpiring(session: SessionState): void {
    // Warn Claude that session window is expiring
    logger.info('[WhatsApp] Session window expiring soon', {
      sessionId: session.sessionId,
      conversationSid: session.conversationSid,
      expiresAt: session.whatsappSessionExpiry
    });

    // Set timer for actual expiry
    if (session.whatsappSessionExpiry) {
      const timeUntilExpiry = session.whatsappSessionExpiry - Date.now();
      if (timeUntilExpiry > 0) {
        session.whatsappSessionTimer = setTimeout(() => {
          this.handleSessionWindowExpired(session);
        }, timeUntilExpiry);
      }
    }
  }

  /**
   * Handle WhatsApp session window fully expired
   */
  private handleSessionWindowExpired(session: SessionState): void {
    logger.info('[WhatsApp] Session window expired', {
      sessionId: session.sessionId,
      conversationSid: session.conversationSid
    });

    // Mark as expired (next message requires template)
    session.whatsappSessionExpiry = undefined;
  }

  /**
   * Close session with reason
   */
  closeSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    logger.info('[Session] Closing session', {
      sessionId,
      reason,
      contactMode: session.contactMode
    });

    // Notify MCP client
    this.notifySessionClosed(session, reason);

    // Clean up
    this.removeSession(sessionId);
  }
}
```

---

### 4. WhatsApp Webhook Handler (SECURITY HARDENED)

**CRITICAL IMPLEMENTATION:** Explicit signature validation and uniform responses.

```typescript
/**
 * WhatsApp webhook endpoint handler
 * POST /whatsapp
 *
 * Security requirements:
 * 1. Validate Twilio signature (prevent forged webhooks)
 * 2. Uniform responses (prevent session enumeration)
 * 3. Rate limiting (prevent DoS attacks)
 * 4. Input validation (prevent injection attacks)
 */
async function handleWhatsAppWebhook(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();

  // ============================================================
  // STEP 1: Signature Validation (CRITICAL)
  // ============================================================

  const signature = req.headers['x-twilio-signature'] as string | undefined;
  const webhookUrl = getFullWebhookUrl(req); // https://example.com/whatsapp

  // Parse request body into URLSearchParams
  // Twilio Conversations webhooks use form-encoded format
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.body)) {
    params.append(key, String(value));
  }

  const isValid = validateTwilioSignature(
    process.env.CALLME_PHONE_AUTH_TOKEN!,
    signature,
    webhookUrl,
    params
  );

  if (!isValid) {
    logger.error('[Security] Invalid webhook signature', {
      path: req.path,
      hasSignature: !!signature
    });

    // Return 401 with empty response (don't leak info)
    res.status(401).send('');
    return;
  }

  // ============================================================
  // STEP 2: Rate Limiting (CRITICAL)
  // ============================================================

  const conversationSid = req.body.ConversationSid;
  const author = req.body.Author; // Phone number (whatsapp:+1234567890)

  if (rateLimiter.isRateLimited(author, conversationSid)) {
    logger.warn('[Security] Rate limit exceeded', {
      conversationSid,
      authorHash: hashForLogging(author)
    });

    // Return 429 with empty response
    res.status(429).send('');
    return;
  }

  // ============================================================
  // STEP 3: Input Validation (CRITICAL)
  // ============================================================

  const validation = validateWhatsAppMessage(req.body);
  if (!validation.valid) {
    logger.warn('[Security] Invalid message payload', {
      error: validation.error,
      conversationSid
    });

    // Return 200 (don't retry invalid payloads)
    res.status(200).send('');
    return;
  }

  const messageBody = validation.sanitized!;

  // ============================================================
  // STEP 4: Session Lookup (CONSTANT TIME)
  // ============================================================

  const session = sessionManager.getSessionByConversation(conversationSid);

  // UNIFORM RESPONSE: Same response whether session found or not
  // This prevents session enumeration attacks

  if (!session) {
    // Session not found (expired, invalid, or never existed)
    logger.info('[WhatsApp] Message for unknown conversation', {
      conversationSid,
      // DO NOT log phone number
    });

    // Return 200 with empty body (SAME as success case)
    res.status(200).send('');
    return;
  }

  // ============================================================
  // STEP 5: Process Message
  // ============================================================

  try {
    // Refresh inactivity timeout
    sessionManager.refreshInactivityTimeout(session);

    // Check for keyword ("call me")
    if (detectCallRequest(messageBody)) {
      // User wants to switch to voice
      await initiateVoiceCall(session);
    } else {
      // Route message to Claude Code
      await routeMessageToMCP(session, messageBody);
    }

    // Return 200 with empty body (SAME as failure case)
    res.status(200).send('');

  } catch (error) {
    logger.error('[WhatsApp] Error processing message', {
      error,
      sessionId: session.sessionId,
      conversationSid
    });

    // Still return 200 (don't let Twilio retry errors)
    res.status(200).send('');
  }

  // Log timing (for monitoring)
  const duration = Date.now() - startTime;
  if (duration > 1000) {
    logger.warn('[Performance] Slow webhook processing', {
      duration,
      conversationSid
    });
  }
}

/**
 * Get full webhook URL for signature validation
 */
function getFullWebhookUrl(req: Request): string {
  const protocol = req.protocol; // http or https
  const host = req.get('host'); // example.com
  const path = req.originalUrl; // /whatsapp

  return `${protocol}://${host}${path}`;
}
```

---

### 5. Rate Limiting Implementation (COMPREHENSIVE)

**CRITICAL IMPLEMENTATION:** Multi-level rate limiting.

```typescript
/**
 * Rate limiting configuration
 */
interface RateLimitConfig {
  // Per-phone number limits
  perPhone: {
    windowMs: number;        // Time window
    maxMessages: number;     // Max messages in window
    blockDurationMs: number; // Block duration after violation
  };

  // Per-conversation limits
  perConversation: {
    windowMs: number;
    maxMessages: number;
  };

  // Global limits (all sources)
  global: {
    windowMs: number;
    maxMessages: number;
  };
}

const RATE_LIMIT_CONFIG: RateLimitConfig = {
  perPhone: {
    windowMs: 60000,        // 1 minute
    maxMessages: 10,        // 10 messages per minute per phone
    blockDurationMs: 300000 // 5 minute block
  },
  perConversation: {
    windowMs: 60000,        // 1 minute
    maxMessages: 20         // 20 messages per minute per conversation
  },
  global: {
    windowMs: 60000,        // 1 minute
    maxMessages: 100        // 100 total messages per minute
  }
};

/**
 * Token bucket rate limiter
 */
class RateLimiter {
  private phoneBuckets = new Map<string, TokenBucket>();
  private conversationBuckets = new Map<string, TokenBucket>();
  private globalBucket: TokenBucket;

  constructor(config: RateLimitConfig) {
    this.globalBucket = new TokenBucket(
      config.global.maxMessages,
      config.global.windowMs
    );
  }

  /**
   * Check if request should be rate limited
   * Returns true if rate limited (reject request)
   */
  isRateLimited(phoneNumber: string, conversationSid: string): boolean {
    // Check global limit first (cheapest check)
    if (!this.globalBucket.tryConsume(1)) {
      return true; // Rate limited globally
    }

    // Check per-phone limit
    const phoneBucket = this.getOrCreatePhoneBucket(phoneNumber);
    if (!phoneBucket.tryConsume(1)) {
      return true; // Rate limited for this phone
    }

    // Check per-conversation limit
    const convBucket = this.getOrCreateConversationBucket(conversationSid);
    if (!convBucket.tryConsume(1)) {
      return true; // Rate limited for this conversation
    }

    return false; // Not rate limited
  }

  private getOrCreatePhoneBucket(phoneNumber: string): TokenBucket {
    let bucket = this.phoneBuckets.get(phoneNumber);
    if (!bucket) {
      bucket = new TokenBucket(
        RATE_LIMIT_CONFIG.perPhone.maxMessages,
        RATE_LIMIT_CONFIG.perPhone.windowMs
      );
      this.phoneBuckets.set(phoneNumber, bucket);

      // Clean up after block duration
      setTimeout(() => {
        this.phoneBuckets.delete(phoneNumber);
      }, RATE_LIMIT_CONFIG.perPhone.blockDurationMs);
    }
    return bucket;
  }

  private getOrCreateConversationBucket(conversationSid: string): TokenBucket {
    let bucket = this.conversationBuckets.get(conversationSid);
    if (!bucket) {
      bucket = new TokenBucket(
        RATE_LIMIT_CONFIG.perConversation.maxMessages,
        RATE_LIMIT_CONFIG.perConversation.windowMs
      );
      this.conversationBuckets.set(conversationSid, bucket);
    }
    return bucket;
  }
}

/**
 * Token bucket implementation
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillIntervalMs: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume tokens
   * Returns true if successful, false if rate limited
   */
  tryConsume(count: number): boolean {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }

    return false;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;

    if (timePassed >= this.refillIntervalMs) {
      this.tokens = this.capacity;
      this.lastRefill = now;
    }
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter(RATE_LIMIT_CONFIG);
```

---

### 6. Input Validation (COMPREHENSIVE)

**CRITICAL IMPLEMENTATION:** Validate all incoming message bodies.

```typescript
interface ValidationResult {
  valid: boolean;
  sanitized?: string;
  error?: string;
}

/**
 * Validate incoming WhatsApp message
 */
function validateWhatsAppMessage(body: any): ValidationResult {
  // 1. Check required fields
  if (!body.ConversationSid || !body.Author || body.Body === undefined) {
    return {
      valid: false,
      error: 'Missing required fields'
    };
  }

  const messageText = String(body.Body);

  // 2. Length validation (64KB max)
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
  const sanitized = messageText.replace(
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
    ''
  );

  // 5. Validate conversation SID format
  if (!isValidConversationSid(body.ConversationSid)) {
    return {
      valid: false,
      error: 'Invalid conversation SID format'
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
 * Validate Twilio conversation SID format
 * Format: CH followed by 32 hexadecimal characters
 */
function isValidConversationSid(sid: string): boolean {
  return /^CH[0-9a-f]{32}$/.test(sid);
}

/**
 * Validate WhatsApp number format
 * Format: whatsapp:+[country code][number]
 */
function isValidWhatsAppNumber(number: string): boolean {
  return /^whatsapp:\+[1-9]\d{6,14}$/.test(number);
}
```

---

### 7. Keyword Detection (RESTRICTIVE)

**CRITICAL CHANGE:** Use restrictive patterns to prevent false positives.

```typescript
/**
 * Call request patterns (start of message only)
 */
const CALL_REQUEST_PATTERNS = [
  /^call me\b/i,           // "call me"
  /^please call\b/i,       // "please call"
  /^can you call\b/i,      // "can you call"
  /^call now\b/i,          // "call now"
  /^phone me\b/i,          // "phone me"
];

/**
 * Detect if message is requesting a phone call
 *
 * Uses restrictive matching to prevent false positives:
 * - "call me" → TRUE
 * - "I'll call you back" → FALSE (doesn't start with pattern)
 * - "recall that..." → FALSE (doesn't match pattern)
 */
function detectCallRequest(message: string): boolean {
  const trimmed = message.trim().toLowerCase();

  // Check for exact matches (case-insensitive)
  if (trimmed === 'call me' || trimmed === 'call' || trimmed === 'phone') {
    return true;
  }

  // Check for pattern matches (must be at start of message)
  for (const pattern of CALL_REQUEST_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

// Test cases
console.assert(detectCallRequest('call me') === true);
console.assert(detectCallRequest('Call me please') === true);
console.assert(detectCallRequest('please call when you can') === true);
console.assert(detectCallRequest("I'll call you back") === false); // FALSE POSITIVE PREVENTED
console.assert(detectCallRequest('recall that we discussed') === false); // FALSE POSITIVE PREVENTED
```

---

### 8. Provider Interface

**Messaging Provider (unchanged):**

```typescript
interface MessagingProvider {
  readonly name: string;
  initialize(config: MessagingConfig): void;
  createConversation(userPhone: string): Promise<string>;
  sendMessage(conversationSid: string, body: string, useTemplate?: boolean): Promise<string>;
  hasActiveSession(conversationSid: string): Promise<boolean>;
  closeConversation(conversationSid: string): Promise<void>;
}

interface MessagingConfig {
  accountSid: string;
  authToken: string;
  whatsappPhoneNumber: string;
  whatsappMode: 'sandbox' | 'production';
  whatsappSandboxCode?: string;
}
```

---

### 9. Configuration

**Environment variables:**

```bash
# Existing
CALLME_PHONE_ACCOUNT_SID=...      # Twilio Account SID
CALLME_PHONE_AUTH_TOKEN=...       # Twilio Auth Token
CALLME_PHONE_NUMBER=...           # Voice call number

# New WhatsApp
CALLME_WHATSAPP_ENABLED=true                    # Enable WhatsApp fallback
CALLME_WHATSAPP_MODE=sandbox                    # "sandbox" or "production"
CALLME_WHATSAPP_PHONE_NUMBER=whatsapp:+14155238886
CALLME_WHATSAPP_SANDBOX_CODE=join-example-code  # Sandbox join code

# Timeouts
CALLME_CALL_TIMEOUT_SECONDS=25        # Time to wait for call answer
CALLME_INACTIVITY_TIMEOUT_MINUTES=7   # Session timeout

# Rate Limiting (optional, defaults shown)
CALLME_RATE_LIMIT_PER_PHONE=10        # Messages per minute per phone
CALLME_RATE_LIMIT_PER_CONVERSATION=20 # Messages per minute per conversation
CALLME_RATE_LIMIT_GLOBAL=100          # Total messages per minute
```

---

## Implementation Order (UPDATED)

**Recommended phase ordering:**

1. **Phase 1: Messaging Provider Interface**
   - Create `MessagingProvider` interface
   - Implement `TwilioConversationsProvider`
   - Add WhatsApp message sending capability
   - Test with sandbox join flow
   - **Effort:** Medium (3-4 days)

2. **Phase 2: Session State & Timeouts** (MOVED EARLIER)
   - Implement secure `SessionManager` with separate phone mapping
   - Add event-driven timeouts (no polling)
   - Implement 24-hour window tracking
   - **Effort:** Medium (2-3 days)

3. **Phase 3: Call Timeout Detection**
   - Add status callback handling (reuse existing)
   - Detect no-answer/declined
   - Trigger WhatsApp fallback
   - Send template message
   - **Effort:** Small (1-2 days)

4. **Phase 4: WhatsApp Webhook** (SECURITY HARDENED)
   - Implement signature validation
   - Implement rate limiting
   - Implement input validation
   - Add uniform response handling
   - Route messages to sessions
   - Implement restrictive keyword detection
   - **Effort:** Large (4-5 days)

5. **Phase 5: MCP Client Updates**
   - Update response formats
   - Handle timeout notifications
   - Update documentation
   - **Effort:** Small (1 day)

6. **Phase 6: Testing & Documentation**
   - Test all scenarios (15 test cases)
   - Document sandbox setup
   - Document production upgrade path
   - **Effort:** Medium (2-3 days)

**Total Estimated Effort:** 13-18 days (~3 weeks)

---

## Testing Scenarios (COMPREHENSIVE)

### Security Testing

1. **Webhook signature validation**
   - Valid signature → accepted
   - Invalid signature → rejected (401)
   - Missing signature → rejected (401)

2. **Rate limiting**
   - 11 messages in 1 minute from same phone → 11th rejected (429)
   - 21 messages in 1 minute to same conversation → 21st rejected (429)
   - 101 total messages in 1 minute → 101st rejected (429)

3. **Session enumeration prevention**
   - Message to valid conversation SID → 200 response
   - Message to invalid conversation SID → 200 response (SAME)
   - Response timing should be constant (no timing attacks)

4. **Input validation**
   - Valid message → processed
   - 70KB message → rejected (message too long)
   - Empty message → rejected
   - Message with control characters → sanitized
   - Invalid conversation SID format → rejected

### Functional Testing

5. **Voice → WhatsApp transition**
   - User doesn't answer call → template sent → user replies → conversation continues

6. **WhatsApp-only flow**
   - Direct message without call → conversation works

7. **Keyword detection**
   - "call me" → triggers voice call
   - "I'll call you back" → does NOT trigger (false positive prevented)

8. **Session continuity**
   - Mix of voice and WhatsApp in same session → state preserved

9. **Inactivity timeout**
   - User goes inactive for 7 minutes → session closes
   - User sends message at 6:59 → timer resets

10. **24-hour window**
    - Message within window → freeform allowed
    - Message after 24 hours → requires template

### Error Scenarios

11. **User not joined sandbox**
    - Error 63015 → clear error message to Claude Code

12. **Webhook failures**
    - Invalid payload → handled gracefully (200 response)
    - Network timeout → retried by Twilio

13. **Phone number never logged**
    - Check all logs → phone numbers never appear in plaintext
    - Session state serialization → no phone numbers

---

## Security Checklist

### Before Implementation

- [ ] All 4 critical security issues addressed in design
- [ ] Webhook signature validation specified with code
- [ ] Rate limiting thresholds defined
- [ ] Phone number storage approach finalized (separate mapping)
- [ ] Input validation rules documented

### During Implementation

- [ ] validateTwilioSignature() applied to /whatsapp endpoint
- [ ] Rate limiter implemented with 3 levels (phone, conversation, global)
- [ ] Input validation for all incoming messages
- [ ] Event-driven timeouts (no polling)
- [ ] Restrictive keyword detection patterns
- [ ] Uniform webhook responses (prevent enumeration)
- [ ] Phone numbers NEVER in session state
- [ ] Phone numbers NEVER in logs

### Before Deployment

- [ ] Security review of implementation
- [ ] Penetration testing (webhook forgery, enumeration, DoS)
- [ ] Load testing (concurrent sessions, rate limits)
- [ ] Privacy review (no phone leakage)
- [ ] Template approval from Meta (production mode)
- [ ] Monitoring and alerting configured

---

## Changelog from v1

**Security Improvements:**
1. ✅ Added explicit webhook signature validation implementation
2. ✅ Added comprehensive rate limiting (3 levels)
3. ✅ Removed phone numbers from session state (separate mapping)
4. ✅ Added uniform webhook responses (prevent enumeration)
5. ✅ Added event-driven session timeouts (no polling)
6. ✅ Added restrictive keyword detection (prevent false positives)
7. ✅ Added comprehensive input validation

**Architecture Changes:**
1. ✅ New `SessionManager` class with secure phone mapping
2. ✅ New `RateLimiter` class with token bucket algorithm
3. ✅ New `validateWhatsAppMessage()` function
4. ✅ New `detectCallRequest()` with restrictive patterns
5. ✅ Event-driven timeouts (replaced polling)

**Phase Reordering:**
1. ✅ Moved Session State to Phase 2 (earlier, foundational)
2. ✅ Call Timeout moved to Phase 3

---

## Sources

Research based on:
- [Twilio WhatsApp API Documentation](https://www.twilio.com/docs/whatsapp/api)
- [Twilio Conversations API Documentation](https://www.twilio.com/docs/conversations)
- [Twilio WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox)
- [Twilio Webhook Security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- Security review recommendations
- Complexity analysis recommendations
