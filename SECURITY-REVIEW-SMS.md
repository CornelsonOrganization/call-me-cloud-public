# Security Review: SMS Fallback Feature

**Review Date:** 2026-01-11
**Reviewer:** Claude (Automated Security Analysis)
**Design Document:** `DESIGN-sms-fallback.md`
**Status:** ⚠️ REQUIRES ATTENTION - Multiple Critical Security Issues Identified

## Executive Summary

The SMS fallback feature design introduces **7 critical security vulnerabilities** and **3 moderate concerns** that must be addressed before implementation. Additionally, the design proposes **no new external dependencies** (reuses existing Twilio SDK), which is positive from a supply chain perspective.

**RECOMMENDATION:** Do not proceed with implementation until the issues below are resolved.

---

## Critical Security Vulnerabilities

### 1. SMS Webhook Lacks Signature Validation ⚠️ CRITICAL

**Issue:** The design specifies a new `POST /sms` endpoint for receiving incoming SMS messages from Twilio, but does not mention implementing signature validation for this endpoint.

**Impact:**
- **Severity: CRITICAL**
- Attackers could forge SMS messages from any phone number
- Session hijacking by sending messages matching active session phone numbers
- Injection of arbitrary messages into Claude conversations
- Potential for social engineering attacks

**Current State:** The codebase already has Twilio signature validation in `src/webhook-security.ts`, but the SMS design doesn't specify using it.

**Required Fix:**
```typescript
// Must validate signature on SMS webhook
POST /sms endpoint must:
1. Extract X-Twilio-Signature header
2. Call validateTwilioSignature() with URL, params, authToken
3. Reject requests with invalid/missing signatures (return 403)
```

**Evidence from codebase:**
- `src/webhook-security.ts:22-59` - Twilio signature validation already implemented for voice webhooks
- Must be applied to SMS endpoint as well

---

### 2. Phone Number Enumeration Attack ⚠️ CRITICAL

**Issue:** The SMS webhook design matches incoming messages to active sessions by phone number. This creates an oracle that reveals active session phone numbers.

**Attack Vector:**
1. Attacker sends SMS from random phone numbers
2. System behavior differs based on whether number matches active session:
   - Match: message routed to session (no error)
   - No match: message ignored (logs for debugging)
3. Attacker can enumerate all active user phone numbers

**Impact:**
- Privacy breach - reveals phone numbers of active users
- Enables targeted social engineering attacks
- GDPR/privacy law implications

**Required Fix:**
```typescript
// Both cases should return same response
if (!session) {
  // Log internally but return 200 OK like normal
  console.warn('[Security] SMS received for unknown session');
  res.status(200).send('<?xml version="1.0"?><Response></Response>');
  return;
}
// Normal case also returns 200 OK
```

Rate limiting should also be implemented (see separate issue).

---

### 3. Session State Stores Plaintext Phone Numbers ⚠️ HIGH

**Issue:** The design adds `phoneNumber: string` to `SessionState` without encryption or hashing.

**Impact:**
- If session state is logged, phone numbers leak to logs
- If state is persisted to disk/redis, phone numbers leak to storage
- Memory dumps expose phone numbers
- Violates data minimization principles

**Required Fix:**
```typescript
// Option 1: Don't store phone number, use session ID mapping
sessionToPhone = new Map<string, string>();  // Not in SessionState

// Option 2: Hash phone number for lookup
phoneHashToSession = new Map<string, string>();
// Use HMAC(secret, phoneNumber) for lookups

// Option 3: Encrypt phone numbers in state
phoneNumber: encrypt(phoneNumber, sessionKey);
```

**Recommendation:** Option 1 is simplest and most secure.

---

### 4. No Rate Limiting on SMS Webhook ⚠️ HIGH

**Issue:** The design doesn't specify rate limiting for the `/sms` endpoint.

**Attack Vectors:**
1. **SMS flood attack:** Attacker sends massive number of messages to exhaust resources
2. **Cost attack:** If system auto-replies, attacker generates cost for the owner
3. **Session state DoS:** Flooding `lastActivityAt` updates prevents legitimate timeouts

**Impact:**
- Denial of service
- Financial cost (if auto-replies implemented)
- Log flooding obscures legitimate traffic

**Required Fix:**
```typescript
// Rate limit by source phone number
const SMS_RATE_LIMIT = {
  window: 60000,      // 1 minute
  maxMessages: 10,    // 10 messages per minute per number
  blockDuration: 300000  // 5 minute block
};

// Implementation using sliding window or token bucket
if (isRateLimited(fromPhoneNumber)) {
  res.status(429).send('<?xml version="1.0"?><Response></Response>');
  return;
}
```

---

### 5. Keyword Detection is Too Permissive ⚠️ MEDIUM-HIGH

**Issue:** The design specifies case-insensitive matching for "call me", "call", "phone me" to trigger calls.

**Attack Vector:**
1. User sends legitimate message: "I'll call you later"
2. System interprets "call" keyword and initiates unwanted call
3. If user is in meeting/sleeping/etc, causes disruption

**Impact:**
- False positive calls
- User frustration
- Potential cost (initiating unnecessary calls)

**Required Fix:**
```typescript
// Use more restrictive matching
const CALL_KEYWORDS = [
  /^call me$/i,
  /^please call$/i,
  /^call now$/i,
  // NOT just "call" which appears in normal conversation
];

// OR: Use position-aware matching
if (message.trim().toLowerCase().startsWith('call')) {
  // Only trigger on messages starting with "call"
}
```

---

### 6. Session Timeout Creates Race Condition ⚠️ MEDIUM

**Issue:** The 7-minute inactivity timeout uses a background timer checking every 60 seconds. This creates a race condition.

**Race Condition:**
```
T+0:00 - User sends SMS
T+6:59 - Timer checks, session is active (lastActivityAt = T+0:00)
T+7:00 - User sends another SMS
T+7:59 - Timer checks, session appears expired (lastActivityAt = T+0:00 due to stale cache)
T+7:59 - Session closed while user is actively messaging
```

**Impact:**
- User sessions closed while actively using
- Messages lost
- Poor user experience

**Required Fix:**
```typescript
// Use event-driven timeouts instead of polling
class Session {
  private timeoutHandle: NodeJS.Timeout;

  refreshTimeout() {
    clearTimeout(this.timeoutHandle);
    this.timeoutHandle = setTimeout(() => {
      this.close('inactivity');
    }, INACTIVITY_TIMEOUT_MS);
  }
}
```

---

### 7. Missing Input Validation on SMS Message Body ⚠️ MEDIUM

**Issue:** The design doesn't specify validation of incoming SMS message bodies.

**Attack Vectors:**
1. **Extremely long messages:** Twilio allows concatenated SMS up to 1600 chars, but attacker could send malformed requests with larger bodies
2. **Control characters:** Null bytes, ANSI escape codes, Unicode directional overrides
3. **Injection attacks:** If message is logged or displayed without sanitization

**Impact:**
- Log injection attacks
- Terminal escape sequence injection
- Potential for Claude API injection if message passed unsanitized

**Required Fix:**
```typescript
// Validate message body
function validateSMSBody(body: string): string | null {
  // Check length
  if (body.length > 2000) {
    return 'Message too long';
  }

  // Remove control characters except newline/tab
  const sanitized = body.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  // Check for null/empty after sanitization
  if (sanitized.trim().length === 0) {
    return 'Empty message';
  }

  return null; // Valid
}
```

---

## Moderate Security Concerns

### 8. No SMS Message Logging Policy ⚠️ PRIVACY

**Issue:** The design doesn't specify what happens to SMS message content. Is it logged? Persisted? Retained?

**Privacy Implications:**
- SMS may contain sensitive personal information
- Retention without user consent may violate privacy laws
- Logs may leak to third parties (log aggregation services)

**Required Fix:**
- Specify explicit logging policy for SMS content
- Consider redacting/hashing SMS content in logs
- Document retention policy
- Add privacy notice in initial SMS

---

### 9. Telnyx Provider Not Considered for SMS ⚠️ COMPLETENESS

**Issue:** The design only mentions Twilio for SMS, but the codebase supports both Twilio and Telnyx for voice calls.

**Gap:**
- If user is using Telnyx for voice, SMS won't work
- Design incompleteness may lead to partial implementation

**Required Fix:**
- Create `SMSProvider` interface as specified
- Implement both `TwilioSMSProvider` and `TelnyxSMSProvider`
- Ensure signature validation works for both (Telnyx uses Ed25519, not HMAC-SHA1)

---

### 10. No Mechanism to Opt Out of SMS ⚠️ UX/PRIVACY

**Issue:** Once SMS fallback is triggered, user has no way to stop receiving messages except waiting for 7-minute timeout.

**Impact:**
- User may not want SMS (prefer call-only)
- Cost implications if user is roaming internationally
- Spam concerns if Claude is overly chatty

**Required Fix:**
```typescript
// Add opt-out keyword
const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'end'];

if (OPT_OUT_KEYWORDS.includes(message.toLowerCase().trim())) {
  closeSession(sessionId);
  sendSMS(phoneNumber, 'Session ended. Have a great day!');
  return;
}
```

---

## Dependency Analysis

### New Dependencies Required: ✅ NONE

**Good News:** The SMS fallback feature requires **no new external dependencies**.

**Rationale:**
- Twilio SMS uses the same API as voice calls (REST API)
- Authentication uses same credentials (`accountSid`, `authToken`)
- No new npm packages needed
- Webhook signature validation already implemented

**Supply Chain Risk:** ✅ **UNCHANGED**

The current dependency surface is:
```json
{
  "openai": "^6.16.0",  // For TTS/STT
  "ws": "^8.18.0"       // For WebSocket
}
```

Twilio and Telnyx APIs are used via native `fetch()` calls, not SDK packages, which reduces supply chain risk.

---

## Recommendations Summary

### Before Implementation (Blockers)

1. ✅ **Add SMS webhook signature validation** (reuse existing `validateTwilioSignature`)
2. ✅ **Implement rate limiting** on `/sms` endpoint
3. ✅ **Fix phone number storage** (don't store in SessionState, use mapping)
4. ✅ **Make keyword detection more restrictive** (avoid false positives)
5. ✅ **Add input validation** for SMS message bodies
6. ✅ **Fix session timeout race condition** (use event-driven timeouts)
7. ✅ **Uniform responses** for valid/invalid phone numbers (prevent enumeration)

### Before Production (Important)

8. ✅ **Define SMS logging policy** and implement redaction
9. ✅ **Implement Telnyx SMS provider** for feature parity
10. ✅ **Add opt-out mechanism** for user control

### Documentation Requirements

- Privacy policy update to mention SMS data handling
- User notification about SMS fallback behavior
- Cost transparency (SMS may cost user money if roaming)

---

## Risk Assessment

| Risk Category | Level | Justification |
|---------------|-------|---------------|
| Authentication | 🔴 **HIGH** | SMS webhook lacks signature validation |
| Authorization | 🟡 **MEDIUM** | Session-phone mapping creates enumeration risk |
| Input Validation | 🟡 **MEDIUM** | Missing validation on SMS bodies |
| Data Privacy | 🟡 **MEDIUM** | Plaintext phone number storage |
| Availability | 🟡 **MEDIUM** | No rate limiting, timeout race condition |
| Supply Chain | 🟢 **LOW** | No new dependencies |

**Overall Risk:** 🔴 **HIGH** - Do not implement without fixing critical issues.

---

## Appendix: Code References

### Existing Security Infrastructure

- **Webhook validation:** `src/webhook-security.ts:22-118`
  - Twilio HMAC-SHA1: lines 22-59
  - Telnyx Ed25519: lines 70-118
  - Replay attack protection (5-minute window): lines 81-89

- **XML injection prevention:** `src/providers/phone-twilio.ts:18-25`
  - Escapes special characters in TwiML generation

- **Authentication:** `src/index.ts:28-33`
  - Bearer token validation for API endpoints
  - Fail-closed if `CALLME_API_KEY` not set

### Missing Security Controls

- Rate limiting infrastructure (not present)
- Input sanitization utilities (not present)
- Phone number encryption/hashing (not present)

---

## Conclusion

The SMS fallback feature design is **architecturally sound** but has **significant security gaps** that must be addressed. The good news is that no new dependencies are required, minimizing supply chain risk. However, the authentication, input validation, and privacy controls must be hardened before implementation proceeds.

**Next Steps:**
1. Review this document with the development team
2. Create tickets for each critical fix
3. Update `DESIGN-sms-fallback.md` to incorporate security requirements
4. Re-review updated design before implementation begins

---

**Prepared by:** Claude Sonnet 4.5
**Contact:** GitHub Issues at riverscornelson/call-me-cloud
