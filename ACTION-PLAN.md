# WhatsApp Fallback - Action Plan (Categorized)

**Design Version:** v2 (Security Hardened)
**Date:** 2026-01-11

This document categorizes all required actions by priority: CRITICAL, HIGH, MEDIUM.

---

## Summary

**CRITICAL Actions:** 7 (must be implemented exactly as specified)
**HIGH Actions:** 8 (strongly recommended, improves quality/security)
**MEDIUM Actions:** 6 (nice-to-have, can defer to later phases)

**Total Implementation Effort:** 13-18 days (~3 weeks)

---

## CRITICAL Actions (MUST DO)

These actions are required for security and correctness. Do NOT skip or compromise on these.

### C1: Implement Webhook Signature Validation

**What:** Validate Twilio HMAC-SHA1 signatures on all /whatsapp webhook requests

**Code Location:** `/src/index.ts` (new `/whatsapp` endpoint)

**Implementation:**
```typescript
// In webhook handler (FIRST thing to check)
const signature = req.headers['x-twilio-signature'] as string | undefined;
const webhookUrl = getFullWebhookUrl(req);
const params = new URLSearchParams(Object.entries(req.body));

const isValid = validateTwilioSignature(
  process.env.CALLME_PHONE_AUTH_TOKEN!,
  signature,
  webhookUrl,
  params
);

if (!isValid) {
  logger.error('[Security] Invalid webhook signature');
  res.status(401).send('');
  return;
}
```

**Effort:** 2-4 hours
**Phase:** Phase 4
**Risk if skipped:** HIGH - Session hijacking, message injection

---

### C2: Implement Phone Number Storage Separation

**What:** Remove `phoneNumber` from `SessionState`, use separate `SessionManager` mapping

**Code Location:** `/src/phone-call.ts` (session state management)

**Implementation:**
- Create new `SessionManager` class with private `conversationToPhone` and `phoneToConversation` Maps
- Remove `phoneNumber: string` from `SessionState` interface
- Add methods: `getPhoneForConversation()`, `getConversationForPhone()`
- NEVER log phone numbers (use `hashForLogging()` if needed)

**Effort:** 4-6 hours
**Phase:** Phase 2
**Risk if skipped:** HIGH - GDPR violations, privacy breach, log leakage

---

### C3: Implement Comprehensive Rate Limiting

**What:** Multi-level rate limiting (per-phone, per-conversation, global)

**Code Location:** New file `/src/rate-limiter.ts`

**Implementation:**
- Create `RateLimiter` class with token bucket algorithm
- Thresholds:
  - Per-phone: 10 msg/min, 5-min block
  - Per-conversation: 20 msg/min
  - Global: 100 msg/min
- Check BEFORE processing webhook (after signature validation)

**Effort:** 6-8 hours
**Phase:** Phase 4
**Risk if skipped:** HIGH - DoS attacks, cost attacks, service degradation

---

### C4: Implement Uniform Webhook Responses

**What:** Return identical responses for valid/invalid conversation SIDs

**Code Location:** `/src/index.ts` (webhook handler)

**Implementation:**
```typescript
// ALWAYS return 200 with empty body
// Don't reveal whether session exists

if (!session) {
  logger.info('[WhatsApp] Unknown conversation');
  res.status(200).send(''); // SAME response as success
  return;
}

// Process message...
res.status(200).send(''); // SAME response as failure
```

**Effort:** 1-2 hours
**Phase:** Phase 4
**Risk if skipped:** MEDIUM-HIGH - Session enumeration, privacy leak

---

### C5: Implement Event-Driven Session Timeouts

**What:** Replace polling with `setTimeout`/`clearTimeout` for inactivity timeouts

**Code Location:** `/src/phone-call.ts` (`SessionManager`)

**Implementation:**
- Add `inactivityTimer` and `whatsappSessionTimer` to `SessionState`
- Create `refreshInactivityTimeout()` method (clears old, sets new setTimeout)
- Call on every message received/sent
- Clear timers on session cleanup

**Effort:** 4-6 hours
**Phase:** Phase 2
**Risk if skipped:** MEDIUM-HIGH - Race conditions, message loss, poor UX

---

### C6: Implement Restrictive Keyword Detection

**What:** Use start-of-message patterns only, prevent false positives

**Code Location:** `/src/phone-call.ts` or new `/src/keyword-detection.ts`

**Implementation:**
```typescript
const CALL_REQUEST_PATTERNS = [
  /^call me\b/i,
  /^please call\b/i,
  /^can you call\b/i,
  /^call now\b/i,
  /^phone me\b/i,
];

function detectCallRequest(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  if (trimmed === 'call me' || trimmed === 'call') return true;
  return CALL_REQUEST_PATTERNS.some(p => p.test(trimmed));
}
```

**Effort:** 2-3 hours
**Phase:** Phase 4
**Risk if skipped:** MEDIUM - False positive calls, user disruption

---

### C7: Implement Input Validation

**What:** Validate all incoming message bodies (length, format, control characters)

**Code Location:** New function in `/src/index.ts` or `/src/validation.ts`

**Implementation:**
- Check required fields (ConversationSid, Author, Body)
- Length validation (max 64KB)
- Remove control characters
- Validate conversation SID format (`/^CH[0-9a-f]{32}$/`)
- Validate WhatsApp number format (`/^whatsapp:\+[1-9]\d{6,14}$/`)

**Effort:** 3-4 hours
**Phase:** Phase 4
**Risk if skipped:** MEDIUM - Injection attacks, service crashes

---

## HIGH Priority Actions (STRONGLY RECOMMENDED)

These actions significantly improve quality, security, or user experience.

### H1: Implement Messaging Provider Interface

**What:** Create `MessagingProvider` interface and Twilio Conversations implementation

**Code Location:**
- `/src/providers/messaging-types.ts` (new)
- `/src/providers/messaging-twilio-conversations.ts` (new)

**Implementation:**
- Define `MessagingProvider` interface with methods: `createConversation()`, `sendMessage()`, `hasActiveSession()`, `closeConversation()`
- Implement `TwilioConversationsProvider` using REST API (no SDK needed)
- Handle 24-hour session window tracking
- Handle template vs freeform message logic

**Effort:** 1-2 days
**Phase:** Phase 1
**Benefits:** Clean abstraction, future extensibility (Teams, Signal)

---

### H2: Implement 24-Hour Window Tracking

**What:** Track WhatsApp's 24-hour freeform message window, warn Claude when expiring

**Code Location:** `/src/phone-call.ts` (`SessionManager`)

**Implementation:**
- Store `whatsappSessionExpiry` timestamp in session
- Set timer for 1 hour before expiry (warning)
- Set timer for expiry (requires template after this)
- Include `whatsappSessionWindow` in API responses

**Effort:** 4-6 hours
**Phase:** Phase 2
**Benefits:** Prevents WhatsApp policy violations, better UX

---

### H3: Implement Call Timeout Detection

**What:** Detect no-answer/declined calls, trigger WhatsApp fallback

**Code Location:** `/src/phone-call.ts` (webhook handlers)

**Implementation:**
- Parse Twilio status callback events
- Detect: `no-answer`, `busy`, `canceled`, `failed`
- Create conversation via messaging provider
- Send template message
- Transition session to WhatsApp mode

**Effort:** 1-2 days
**Phase:** Phase 3
**Benefits:** Core fallback functionality

---

### H4: Update MCP Client Responses

**What:** Add `contactMode`, `whatsappSessionExpiry`, `conversationSid` to API responses

**Code Location:** `/mcp-client/index.ts`

**Implementation:**
- Update response parsing for `initiate_call` and `continue_call`
- Add `contactMode: 'voice' | 'whatsapp'` field
- Add `whatsappSessionWindow` object with status/expiry
- Handle timeout notifications

**Effort:** 4-6 hours
**Phase:** Phase 5
**Benefits:** Claude Code knows current mode, can adapt behavior

---

### H5: Implement Sandbox Join Flow Handling

**What:** Detect Error 63015 (user not in sandbox), provide clear error message

**Code Location:** `/src/providers/messaging-twilio-conversations.ts`

**Implementation:**
```typescript
try {
  await sendTemplateMessage(conversationSid, message);
} catch (error) {
  if (error.code === 63015) {
    return {
      error: 'whatsapp_opt_in_required',
      message: `User needs to join WhatsApp sandbox by sending 'join ${SANDBOX_CODE}' to ${WHATSAPP_NUMBER}`
    };
  }
  throw error;
}
```

**Effort:** 2-3 hours
**Phase:** Phase 1
**Benefits:** Better error messages, clearer user guidance

---

### H6: Implement Retry Logic with Backoff

**What:** Retry failed WhatsApp sends with exponential backoff

**Code Location:** `/src/providers/messaging-twilio-conversations.ts`

**Implementation:**
- Max 3 attempts
- Initial delay: 2 seconds
- Backoff multiplier: 2x
- Only retry transient errors (network, timeout)
- Don't retry: opt-in required, invalid number

**Effort:** 3-4 hours
**Phase:** Phase 1
**Benefits:** Resilience to transient failures

---

### H7: Implement Session Persistence (Redis)

**What:** Persist sessions to Redis for server restart recovery

**Code Location:** `/src/phone-call.ts` (`SessionManager`)

**Implementation:**
- Serialize session state to Redis on updates
- Restore sessions on server startup
- NEVER persist phone numbers (only conversation SIDs)
- Set TTL to inactivity timeout + buffer

**Effort:** 6-8 hours
**Phase:** Phase 2 (optional)
**Benefits:** Graceful server restarts, no session loss

---

### H8: Implement Comprehensive Testing

**What:** Write 15 test cases (7 functional, 5 error, 3 security)

**Code Location:** New test files

**Implementation:**
- Unit tests for rate limiter, keyword detection, input validation
- Integration tests for webhook flow
- Manual tests with Twilio sandbox

**Effort:** 1-2 days
**Phase:** Phase 6
**Benefits:** Confidence in implementation, catch regressions

---

## MEDIUM Priority Actions (NICE-TO-HAVE)

These actions improve the feature but can be deferred to later phases or skipped for MVP.

### M1: Implement `send_message` MCP Tool

**What:** Add optional tool to send WhatsApp messages without calling first

**Code Location:** `/mcp-client/index.ts`

**Implementation:**
- Add new MCP tool definition
- Goes straight to WhatsApp (skips call attempt)
- Must specify if first contact (requires template)

**Effort:** 3-4 hours
**Phase:** Phase 5 (optional)
**Benefits:** Flexibility for non-urgent messages

---

### M2: Implement Logging Policy

**What:** Define what gets logged, redact sensitive data

**Code Location:** Global logger configuration

**Implementation:**
- Never log phone numbers (use hashed version if needed)
- Redact credit cards, SSNs, emails from message bodies
- Define retention policy (e.g., 30 days)

**Effort:** 2-3 hours
**Phase:** All phases
**Benefits:** Privacy compliance, security

---

### M3: Implement Multi-Language Keyword Detection

**What:** Support "call me" in Spanish, French, etc.

**Code Location:** `/src/keyword-detection.ts`

**Implementation:**
```typescript
const CALL_PATTERNS = {
  en: [/^call me\b/i, /^phone me\b/i],
  es: [/^llámame\b/i, /^llama\b/i],
  fr: [/^appelle-moi\b/i],
  // ...
};
```

**Effort:** 2-3 hours
**Phase:** Phase 4 (optional)
**Benefits:** International user support

---

### M4: Implement Monitoring & Alerting

**What:** Set up monitoring dashboards and alerts

**Implementation:**
- Alert on rate limit violations
- Alert on webhook signature failures
- Alert on high error rates
- Dashboard for message volume, session counts

**Effort:** 4-6 hours
**Phase:** Phase 6
**Benefits:** Operational visibility, faster incident response

---

### M5: Implement Graceful Degradation (SMS Fallback)

**What:** Fall back to SMS if WhatsApp completely fails

**Code Location:** `/src/phone-call.ts` (fallback logic)

**Implementation:**
- Detect persistent WhatsApp failures
- Attempt SMS send as last resort
- Configuration flag: `CALLME_WHATSAPP_FALLBACK_TO_SMS`

**Effort:** 4-6 hours
**Phase:** Phase 3 (optional)
**Benefits:** Higher reliability, but SMS has security issues

**Note:** User explicitly wanted to remove SMS, so this may not be desired.

---

### M6: Document Production Upgrade Path

**What:** Write guide for upgrading from sandbox to production

**Code Location:** `PRODUCTION-UPGRADE.md` (new)

**Implementation:**
- Meta Business Manager setup steps
- WhatsApp Business Account registration
- Template creation and approval process
- Configuration changes needed
- Testing checklist

**Effort:** 2-3 hours
**Phase:** Phase 6
**Benefits:** Smooth production transition

---

## Implementation Timeline

### Week 1 (Days 1-5)

**Phase 1: Messaging Provider**
- [ ] C2: Phone number storage separation (H: 4-6 hours)
- [ ] H1: Messaging provider interface (1-2 days)
- [ ] H5: Sandbox join flow handling (2-3 hours)
- [ ] H6: Retry logic (3-4 hours)

**Phase 2: Session State & Timeouts**
- [ ] C5: Event-driven timeouts (4-6 hours)
- [ ] H2: 24-hour window tracking (4-6 hours)
- [ ] H7: Session persistence (optional, 6-8 hours)

**End of Week 1:** Messaging provider ready, session management solid

### Week 2 (Days 6-10)

**Phase 3: Call Timeout Detection**
- [ ] H3: Call timeout detection and fallback (1-2 days)

**Phase 4: WhatsApp Webhook (HEAVY WEEK)**
- [ ] C1: Webhook signature validation (2-4 hours)
- [ ] C3: Rate limiting (6-8 hours)
- [ ] C4: Uniform responses (1-2 hours)
- [ ] C6: Restrictive keyword detection (2-3 hours)
- [ ] C7: Input validation (3-4 hours)

**End of Week 2:** Core functionality complete, security hardened

### Week 3 (Days 11-15)

**Phase 5: MCP Client Updates**
- [ ] H4: Update MCP responses (4-6 hours)
- [ ] M1: `send_message` tool (optional, 3-4 hours)

**Phase 6: Testing & Documentation**
- [ ] H8: Comprehensive testing (1-2 days)
- [ ] M4: Monitoring setup (4-6 hours)
- [ ] M6: Production upgrade guide (2-3 hours)
- [ ] Final integration testing
- [ ] Documentation review

**End of Week 3:** Feature complete, tested, documented

---

## Pre-Implementation Checklist

Before starting Phase 1:

- [ ] User approval of v2 design document
- [ ] Twilio sandbox account accessible
- [ ] Development environment set up
- [ ] Test phone numbers available (at least 2)
- [ ] 4-6 hours allocated for prototyping (recommended)

---

## Prototyping Recommendations (BEFORE Phase 1)

Spend 4-6 hours validating assumptions:

1. **Twilio Conversations API REST calls** (1-2 hours)
   - Create conversation via API
   - Send template message
   - Send freeform message
   - Verify 24-hour window behavior

2. **Conversation SID webhook routing** (1 hour)
   - Mock webhook payload from Twilio
   - Extract conversation SID
   - Test session lookup

3. **Background session timeout mechanism** (2-3 hours)
   - Implement simple setTimeout test
   - Verify timer cleanup
   - Test under load (100+ timers)

**Goal:** Catch surprises early, validate design assumptions.

---

## Decision Points

### Decision 1: Session Persistence

**Options:**
- A) In-memory only (simpler, lose sessions on restart)
- B) Redis persistence (H7, more complex, survives restarts)

**Recommendation:** Start with A (in-memory), add B later if needed.

---

### Decision 2: SMS Fallback

**Options:**
- A) WhatsApp only (user's original request)
- B) WhatsApp + SMS fallback (M5, higher reliability)

**Recommendation:** A (WhatsApp only) based on user's security concerns about SMS.

---

### Decision 3: Testing Depth

**Options:**
- A) Manual testing only (faster, less confident)
- B) Automated + manual testing (H8, slower, more confident)

**Recommendation:** B (automated + manual) for CRITICAL security features, A for others.

---

## Success Criteria

**Must Have (CRITICAL):**
- [ ] All 7 CRITICAL actions (C1-C7) implemented
- [ ] Webhook signature validation working
- [ ] Rate limiting preventing DoS
- [ ] Phone numbers never in logs or session state
- [ ] Voice → WhatsApp fallback working
- [ ] Security testing passed

**Should Have (HIGH):**
- [ ] At least 6 of 8 HIGH actions implemented
- [ ] 24-hour window tracking working
- [ ] MCP client updated with new fields
- [ ] Error handling for sandbox opt-in

**Nice to Have (MEDIUM):**
- [ ] At least 2 of 6 MEDIUM actions implemented
- [ ] Monitoring dashboard
- [ ] Production upgrade guide

---

## Risk Mitigation

**Risk 1: Twilio Conversations API surprises**
- **Mitigation:** Prototype first (4-6 hours)

**Risk 2: Rate limiting too strict/loose**
- **Mitigation:** Make thresholds configurable, monitor in production

**Risk 3: 24-hour window edge cases**
- **Mitigation:** Thorough testing (test case #10), warn Claude proactively

**Risk 4: Memory leaks from timers**
- **Mitigation:** Code review, load testing, monitoring

**Risk 5: Template approval delays (production)**
- **Mitigation:** Start with sandbox, document production separately

---

## Questions for User

Before proceeding:

1. **Timeline:** Is 3 weeks (13-18 days) acceptable?
2. **Scope:** Agree to implement all 7 CRITICAL actions?
3. **Optional Features:** Which HIGH/MEDIUM actions should be included in MVP?
4. **Testing:** Allocate time for comprehensive testing (1-2 days)?
5. **Prototyping:** Can 4-6 hours be spent prototyping first?
6. **SMS Fallback:** Confirm WhatsApp-only approach (no SMS)?

---

**End of Action Plan**
