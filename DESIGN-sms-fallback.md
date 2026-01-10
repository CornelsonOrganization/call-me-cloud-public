# SMS Fallback Design

## Overview

Add SMS fallback behavior to the call-me system. When a user doesn't answer a call, the system automatically falls back to SMS messaging. The session maintains continuity between voice and text modalities.

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
Send SMS with the message
    ↓
User replies via SMS
    ↓
Check for "call me" keyword? ──YES──→ Try calling again
    │
    NO
    ↓
Continue conversation via SMS
    ↓
7-minute inactivity? ──YES──→ Session closes, user returns to Claude Code manually
    │
    NO
    ↓
(loop back to "User replies via SMS")
```

## Design Details

### 1. Call Timeout & SMS Fallback

**Behavior:**
- Initiate call as normal
- Wait ~25 seconds for user to answer
- If call goes to voicemail or is declined, send SMS with the original message
- Transition session to "SMS mode"

**Implementation:**
- Add `CallStatus` type: `'ringing' | 'answered' | 'declined' | 'no-answer' | 'voicemail'`
- Detect call outcome via Twilio webhook status callbacks:
  - `answered` → proceed with voice
  - `no-answer` / `busy` / `canceled` / `failed` → trigger SMS fallback
- Create new `SMSProvider` interface and `TwilioSMSProvider` implementation
- Store `contactMode: 'voice' | 'sms'` in session state

### 2. Session State

**New fields in session state:**

```typescript
interface SessionState {
  // Existing fields...
  callId: string;

  // New fields
  contactMode: 'voice' | 'sms';
  phoneNumber: string;           // User's phone number for SMS
  lastActivityAt: number;        // Timestamp for inactivity timeout
  pendingResponse: boolean;      // Waiting for user reply
  smsConversationSid?: string;   // Twilio conversation tracking
}
```

### 3. SMS Reply Handling

**Webhook endpoint:** `POST /sms`

**Behavior:**
1. Receive incoming SMS from Twilio
2. Match phone number to active session
3. Parse message for "call me" keyword
4. If "call me" found: transition back to voice, initiate call
5. Otherwise: route message to Claude Code as user response

**Keyword detection:**
- Case-insensitive match for: "call me", "call", "phone me"
- Simple string matching (no LLM needed)

### 4. Inactivity Timeout

**Behavior:**
- Track `lastActivityAt` timestamp
- Update on: user reply, Claude response sent
- After 7 minutes of inactivity: close session
- Closing means: return control to Claude Code with timeout message

**Implementation:**
- Background timer checks sessions every 60 seconds
- On timeout: clean up session, notify MCP client

### 5. API Changes

**Existing endpoints (modified):**

`POST /api/call` - Initiate contact
- Same interface
- Returns additional field: `contactMode: 'voice' | 'sms'`
- May return SMS response if call wasn't answered

`POST /api/call/{id}/continue` - Continue conversation
- Works for both voice and SMS modes
- Returns `contactMode` in response

**New webhook endpoint:**

`POST /sms` - Receive incoming SMS
- Twilio webhook for incoming messages
- Routes to appropriate session
- Triggers callback to waiting API request

### 6. Provider Interface

**New SMS Provider:**

```typescript
interface SMSProvider {
  readonly name: string;

  initialize(config: SMSConfig): void;

  /**
   * Send an SMS message
   * @returns Message SID from provider
   */
  sendMessage(to: string, from: string, body: string): Promise<string>;
}

interface SMSConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;  // From number
}
```

**Twilio Implementation:**
- Use Twilio REST API: `/2010-04-01/Accounts/{sid}/Messages.json`
- Reuse existing credentials from phone provider

### 7. MCP Client Changes

**New tool:** `send_message`
- Alternative to `initiate_call` that goes straight to SMS
- Optional, for cases where voice isn't needed

**Modified responses:**
- `initiate_call` returns `contactMode` field
- All responses indicate current mode
- Timeout responses include reason

### 8. Configuration

**Environment variables:**

```bash
# Existing
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...

# New
CALLME_CALL_TIMEOUT_SECONDS=25        # Time to wait for call answer
CALLME_INACTIVITY_TIMEOUT_MINUTES=7   # Session timeout
CALLME_SMS_WEBHOOK_PATH=/sms          # Webhook path for incoming SMS
```

### 9. Error Handling

**SMS send failure:**
- Retry once after 2 seconds
- If still fails, return error to Claude Code
- Don't leave session in limbo

**Webhook validation:**
- Validate Twilio signature on SMS webhooks (same as voice)
- Reject invalid requests

**Session not found:**
- If SMS received for unknown session, ignore (log for debugging)
- Could optionally reply with "session expired" message

## Implementation Order

1. **Phase 1: SMS Provider**
   - Create `SMSProvider` interface
   - Implement `TwilioSMSProvider`
   - Add SMS sending capability

2. **Phase 2: Call Timeout Detection**
   - Add status callback handling
   - Detect no-answer/declined
   - Trigger SMS fallback

3. **Phase 3: Session State**
   - Add `contactMode` and related fields
   - Track sessions across modalities
   - Implement inactivity timeout

4. **Phase 4: SMS Webhook**
   - Add `/sms` endpoint
   - Route incoming messages to sessions
   - Implement keyword detection

5. **Phase 5: MCP Client Updates**
   - Update response formats
   - Handle timeout notifications

## Testing Scenarios

1. User answers call → normal voice flow
2. User declines call → SMS sent, reply continues via SMS
3. User doesn't answer → SMS sent after timeout
4. User texts "call me" → system calls back
5. User goes inactive → session closes after 7 minutes
6. Invalid SMS webhook → rejected
7. SMS to unknown session → ignored

## Notes

- Twilio uses same credentials for voice and SMS
- Phone number used for both voice and SMS
- SMS messages have 1600 character limit (split if needed)
- Consider rate limiting on SMS sends
