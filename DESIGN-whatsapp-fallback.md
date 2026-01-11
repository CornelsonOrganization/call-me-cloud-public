# WhatsApp Fallback Design

## Overview

Add WhatsApp fallback behavior to the call-me system. When a user doesn't answer a call, the system automatically falls back to WhatsApp messaging using Twilio's Conversations API. The session maintains continuity between voice and messaging modalities with end-to-end encryption.

## Architecture Decisions

**Key decisions made:**
1. **Messaging API**: Twilio Conversations API (multi-channel, conversation history, future extensibility)
2. **Fallback chain**: Voice → WhatsApp only (no SMS, WhatsApp provides encryption)
3. **WhatsApp mode**: Sandbox mode (simplifies testing, no Meta Business Manager required)
4. **Provider abstraction**: Create unified messaging provider interface for future Teams/Signal support
5. **Templates**: Use pre-approved sandbox templates initially, document production template requirements

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

### 2. Session State

**New fields in session state:**

```typescript
interface SessionState {
  // Existing fields...
  callId: string;

  // New fields
  contactMode: 'voice' | 'whatsapp';
  phoneNumber: string;              // User's phone number for WhatsApp
  lastActivityAt: number;           // Timestamp for inactivity timeout
  pendingResponse: boolean;         // Waiting for user reply
  conversationSid?: string;         // Twilio Conversations SID
  whatsappSessionExpiry?: number;   // 24-hour session window timestamp
}
```

### 3. WhatsApp Message Handling

**Webhook endpoint:** `POST /whatsapp` (or unified `/messaging` endpoint)

**Behavior:**
1. Receive incoming WhatsApp message from Twilio Conversations webhook
2. Match phone number to active session via conversation SID
3. Parse message for "call me" keyword
4. If "call me" found: transition back to voice, initiate call
5. Otherwise: route message to Claude Code as user response
6. Update 24-hour session window timestamp

**Keyword detection:**
- Case-insensitive match for: "call me", "call", "phone me"
- Simple string matching (no LLM needed)
- Could extend to other languages in future

### 4. Inactivity Timeout

**Behavior:**
- Track `lastActivityAt` timestamp
- Update on: user reply, Claude response sent
- After 7 minutes of inactivity: close session
- Closing means: return control to Claude Code with timeout message

**Implementation:**
- Background timer checks sessions every 60 seconds
- On timeout: clean up session, close conversation, notify MCP client

**24-hour session window:**
- Track `whatsappSessionExpiry` separately from inactivity timeout
- If 24 hours elapse and user sends message, need to start with template again
- Warn Claude if approaching 24-hour limit during active conversation

### 5. API Changes

**Existing endpoints (modified):**

`POST /api/call` - Initiate contact
- Same interface
- Returns additional field: `contactMode: 'voice' | 'whatsapp'`
- May return WhatsApp response if call wasn't answered

`POST /api/call/{id}/continue` - Continue conversation
- Works for both voice and WhatsApp modes
- Returns `contactMode` in response
- Includes `whatsappSessionExpiry` if in WhatsApp mode

**New webhook endpoint:**

`POST /whatsapp` (or `/messaging`) - Receive incoming messages
- Twilio Conversations webhook for incoming WhatsApp messages
- Routes to appropriate session via conversation SID
- Triggers callback to waiting API request
- Same security validation as voice webhooks (HMAC-SHA1)

### 6. Provider Interface

**New Messaging Provider:**

```typescript
interface MessagingProvider {
  readonly name: string;

  initialize(config: MessagingConfig): void;

  /**
   * Create a conversation with a user
   * @returns Conversation SID from provider
   */
  createConversation(userPhone: string): Promise<string>;

  /**
   * Send a message in a conversation
   * @param conversationSid The conversation identifier
   * @param body Message text
   * @param useTemplate Whether to use approved template (for business-initiated)
   * @returns Message SID
   */
  sendMessage(
    conversationSid: string,
    body: string,
    useTemplate?: boolean
  ): Promise<string>;

  /**
   * Check if conversation has active session window (within 24 hours)
   */
  hasActiveSession(conversationSid: string): Promise<boolean>;

  /**
   * Close a conversation
   */
  closeConversation(conversationSid: string): Promise<void>;
}

interface MessagingConfig {
  accountSid: string;
  authToken: string;

  // WhatsApp-specific
  whatsappPhoneNumber: string;  // e.g., "whatsapp:+14155238886"
  whatsappMode: 'sandbox' | 'production';
  whatsappSandboxCode?: string; // Join code for sandbox

  // Future: Teams, Signal, etc.
  teamsWebhookUrl?: string;
  signalNumber?: string;
}
```

**Twilio Conversations Implementation:**
- Use Twilio Conversations REST API
- Participant binding: WhatsApp channel
- Reuse existing Twilio credentials from phone provider
- Handle conversation lifecycle: create → message → close

### 7. MCP Client Changes

**New tool:** `send_message`
- Alternative to `initiate_call` that goes straight to WhatsApp
- Optional, for cases where voice isn't needed
- Must specify if this is first contact (requires template)

**Modified responses:**
- `initiate_call` returns `contactMode` field
- All responses indicate current mode
- WhatsApp responses include session window info
- Timeout responses include reason

**Example response:**
```typescript
{
  callId: "call-123",
  contactMode: "whatsapp",
  userResponse: "Yes, I got your message",
  whatsappSessionExpiry: 1736156735424, // 24 hours from first reply
  conversationSid: "CHxxxxxxxxxxxxxxxx"
}
```

### 8. Configuration

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
CALLME_WHATSAPP_WEBHOOK_PATH=/whatsapp  # Webhook path for incoming messages
```

### 9. Error Handling

**WhatsApp send failure:**
- Retry once after 2 seconds
- If still fails, return error to Claude Code with specific error message
- Don't leave session in limbo
- Possible errors:
  - User not joined sandbox (Error 63015)
  - 24-hour window expired (need template)
  - Rate limit exceeded (sandbox: 1 msg/3 sec)

**Webhook validation:**
- Validate Twilio signature on WhatsApp webhooks (same HMAC-SHA1 as voice)
- Use existing `validateTwilioSignature()` function from `webhook-security.ts`
- Reject invalid requests

**Session not found:**
- If WhatsApp message received for unknown conversation, ignore (log for debugging)
- Could optionally reply with "session expired" message via Conversations API

**Opt-in not completed:**
- Detect Error 63015 (user not in sandbox)
- Return clear error to Claude Code: "User needs to join WhatsApp sandbox by sending 'join <code>' to <number>"
- Don't fail silently

### 10. Message Templates

**Sandbox mode (initial implementation):**
- Use pre-approved sandbox templates
- Example template categories available:
  - Appointment reminder (adapt for "tried calling you")
  - Order notification (adapt for "message from Claude")
- Template must include call-to-action: "Please reply with your feedback or question"

**Production mode (future):**
- Create custom template via Twilio Content Template Builder
- Submit for Meta approval (can take 1-3 days)
- Template example:
  ```
  Hi {{1}}, I tried calling but couldn't reach you.

  Message: {{2}}

  Please reply to continue our conversation.
  ```
- Categories: Utility (transactional) or Marketing (promotional)

### 11. Security Considerations

**Inherited from existing security:**
- ✅ Webhook signature validation (Twilio HMAC-SHA1)
- ✅ HTTPS endpoints required
- ✅ Auth token stored securely in environment variables

**WhatsApp-specific security:**
- ✅ End-to-end encryption (provided by WhatsApp)
- ✅ User opt-in required (sandbox join code)
- ✅ Rate limiting (inherent in sandbox: 1 msg/3 sec)
- ✅ Session validation (conversation SID matching)

**New security measures needed:**
- Add rate limiting on webhook endpoint (prevent message flooding)
- Validate conversation SID belongs to active session
- Handle malformed WhatsApp messages gracefully
- Timeout cleanup to prevent stale sessions

**Issues resolved from SMS design:**
- ✅ No plaintext SMS vulnerabilities (WhatsApp E2E encrypted)
- ✅ No phone number enumeration (conversation SID-based)
- ✅ Built-in spam protection (WhatsApp Business Platform)

## Implementation Order

1. **Phase 1: Messaging Provider Interface**
   - Create `MessagingProvider` interface
   - Implement `TwilioConversationsProvider`
   - Add WhatsApp message sending capability
   - Test with sandbox join flow

2. **Phase 2: Call Timeout Detection**
   - Add status callback handling (reuse existing)
   - Detect no-answer/declined
   - Trigger WhatsApp fallback instead of SMS
   - Send template message

3. **Phase 3: Session State Updates**
   - Add `contactMode: 'whatsapp'` support
   - Add `conversationSid` and `whatsappSessionExpiry`
   - Track sessions across modalities
   - Implement 24-hour window tracking

4. **Phase 4: WhatsApp Webhook**
   - Add `/whatsapp` endpoint
   - Route incoming messages to sessions via conversation SID
   - Implement keyword detection
   - Validate Twilio signatures

5. **Phase 5: MCP Client Updates**
   - Update response formats to include WhatsApp fields
   - Handle timeout notifications
   - Add `send_message` tool (optional)
   - Update documentation

6. **Phase 6: Testing & Documentation**
   - Test all scenarios (see below)
   - Document sandbox setup for users
   - Document production upgrade path
   - Update README with WhatsApp configuration

## Testing Scenarios

### Functional Testing (Sandbox)

1. **Voice → WhatsApp transition**
   - User doesn't answer call → template sent → user replies → conversation continues

2. **WhatsApp-only flow**
   - Direct message without call → conversation works

3. **Keyword detection**
   - User texts "call me" → system calls back → voice conversation

4. **Session continuity**
   - Mix of voice and WhatsApp in same session → state preserved

5. **Inactivity timeout**
   - User goes inactive for 7 minutes → session closes gracefully

6. **24-hour window**
   - Test message within window → freeform allowed
   - Test message after 24 hours → requires template again

7. **Security**
   - Invalid webhook signature → rejected
   - Unknown conversation SID → ignored

### Error Scenarios

8. **User not joined sandbox**
   - Error 63015 → clear error message to Claude Code

9. **Rate limiting**
   - Rapid messages → throttled appropriately

10. **Webhook failure**
    - Invalid payload → handled gracefully

### Production Upgrade Testing (Future)

11. **Custom template**
    - Submit template → get approved → use in production

12. **High throughput**
    - Production rate limits (80+ msg/sec)

## Migration from SMS Design

**What changed:**
- ❌ Removed: Direct SMS API integration
- ✅ Added: Twilio Conversations API
- ✅ Added: WhatsApp-specific template handling
- ✅ Added: 24-hour session window tracking
- ✅ Added: Opt-in/sandbox join requirement
- ✅ Changed: Webhook security (same HMAC but different endpoint)
- ✅ Changed: Provider interface (more sophisticated conversation model)

**What stayed the same:**
- ✅ Call timeout & fallback trigger logic
- ✅ Keyword detection ("call me")
- ✅ Inactivity timeout (7 minutes)
- ✅ Session state architecture
- ✅ MCP client integration points

## Notes

- Twilio uses same credentials for voice and Conversations API
- WhatsApp number can be different from voice number (sandbox uses shared number)
- WhatsApp messages have much higher limits than SMS (no 160-char constraint)
- Conversations API handles message routing automatically
- Sandbox join code is unique per Twilio account
- Sandbox session expires after 3 days (users need to rejoin)
- Production requires Meta Business Manager + WhatsApp Business Account
- Future extensibility: Add Teams/Signal by implementing `MessagingProvider` interface

## Production Upgrade Path (Future)

**When to upgrade from sandbox to production:**
- Need more than 1 message every 3 seconds
- Want custom branded templates
- Need to message users without manual opt-in
- Scaling beyond small team/personal use

**Steps:**
1. Create Meta Business Manager account
2. Register WhatsApp Business Account (WABA)
3. Connect WABA to Twilio account
4. Register dedicated phone number for WhatsApp
5. Create and submit custom templates for approval
6. Update config: `CALLME_WHATSAPP_MODE=production`
7. Test with production templates

**Estimated timeline:** 3-7 days for Meta approval

## Sources

Research based on:
- [Twilio WhatsApp API Documentation](https://www.twilio.com/docs/whatsapp/api)
- [Twilio Conversations API Documentation](https://www.twilio.com/docs/conversations)
- [Twilio WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox)
- [WhatsApp Business Platform Pricing](https://business.whatsapp.com/products/platform-pricing)
- [Twilio Webhook Security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
