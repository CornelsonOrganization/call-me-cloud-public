# WhatsApp Integration Design Questions

Based on research of Twilio WhatsApp API and the existing SMS fallback design, here are the key questions that need answers to update the feature design.

---

## 1. User Onboarding & Opt-In

**Q1.1: How do we handle WhatsApp opt-in requirements?**
- WhatsApp requires explicit user opt-ins before sending messages
- Meta can suspend accounts for unsolicited messaging
- Options:
  - A) Require users to message the bot first (sandbox approach)
  - B) Build a registration flow where users opt-in via web/SMS
  - C) Use WhatsApp opt-in templates approved by Meta
  - D) Assume enterprise users configure opt-ins out-of-band

**Q1.2: What happens if a user hasn't opted in?**
- Should we fall back to SMS instead?
- Show an error to Claude Code?
- Queue the message until opt-in is confirmed?

---

## 2. WhatsApp Business Account Setup

**Q2.1: Do we use Twilio's WhatsApp Sandbox or Production API?**
- **Sandbox**: Instant testing, shared number, join code required, good for prototyping
- **Production**: Requires Meta Business Manager, WhatsApp Business Account approval, dedicated number

**Q2.2: Should we support both Sandbox and Production modes?**
- Configuration flag to switch between modes?
- Automatic detection based on phone number format?

**Q2.3: How do we handle the WhatsApp phone number?**
- Can we reuse the same Twilio number used for voice calls?
- Or does WhatsApp require a separate dedicated number?
- What's the configuration story?

---

## 3. Architecture: Conversations API vs Programmable Messaging

**Q3.1: Should we use Twilio Conversations API or Programmable Messaging API?**

**Option A: Conversations API**
- ✅ Multi-channel support (WhatsApp, SMS, Chat in one API)
- ✅ Maintains conversation context and history automatically
- ✅ Single codebase for WhatsApp + SMS fallback
- ❌ More complex, higher learning curve
- ❌ Additional pricing tier

**Option B: Programmable Messaging API**
- ✅ Simpler, direct message sending
- ✅ Already familiar (similar to SMS)
- ✅ Lower cost per message
- ❌ Manual session tracking
- ❌ Separate implementations for SMS vs WhatsApp

**Recommendation needed:** Which approach fits the call-me architecture better?

---

## 4. Message Templates vs Freeform Messages

**Q4.1: Do we need WhatsApp message templates?**
- **Templates required for**: Business-initiated conversations outside 24-hour window
- **Freeform allowed for**: Responses within 24 hours of user message
- Initial "call failed, switching to WhatsApp" message:
  - Is this business-initiated (needs template)?
  - Or is it part of an existing call session (might be exempt)?

**Q4.2: What templates do we need to create and get approved?**
Example templates needed:
- "Hi {{1}}, I tried calling but couldn't reach you. {{2}}"
- "Your Claude assistant has a message: {{1}}"
- Other templates?

**Q4.3: How do we handle template approval delays?**
- Meta review can take days
- Do we block the feature launch?
- Fall back to SMS if templates aren't approved?

---

## 5. Session Management & State

**Q5.1: How do we map calls to WhatsApp conversations?**
Current design uses phone numbers to track sessions. With WhatsApp:
- User's WhatsApp number = their phone number (works same as SMS)
- But WhatsApp has conversation IDs - should we use those?
- How do we handle users with different WhatsApp vs phone numbers?

**Q5.2: Should we maintain separate session states for Voice vs WhatsApp vs SMS?**
- One unified session across all modalities?
- Separate sessions that can transition between modes?
- What happens to session state when switching?

---

## 6. Webhook Security

**Q6.1: Does WhatsApp use the same Twilio webhook signature validation?**
- Research indicates YES - same HMAC-SHA1 signature as voice/SMS
- Confirm: can we reuse existing `validateTwilioSignature()` function?
- Are there any WhatsApp-specific security headers?

**Q6.2: Do we need separate webhook endpoints?**
- `/whatsapp` for WhatsApp messages (separate from `/sms`)
- `/messaging` unified endpoint for all message types
- Keep them separate for security/isolation?

---

## 7. Fallback Chain

**Q7.1: What's the fallback priority?**

Current SMS design:
```
Voice (no answer) → SMS
```

With WhatsApp:
```
Option A: Voice → WhatsApp → SMS (if WhatsApp fails)
Option B: Voice → WhatsApp (no SMS fallback)
Option C: Voice → SMS (skip WhatsApp for v1)
Option D: User configurable fallback preference
```

**Q7.2: What triggers a fallback from WhatsApp to SMS?**
- User not on WhatsApp
- User hasn't opted in
- WhatsApp send failure
- No response after X minutes
- All of the above?

---

## 8. Keyword Detection ("call me")

**Q8.1: Does the "call me" keyword work the same on WhatsApp?**
- Same simple string matching as SMS design?
- Case-insensitive matching?
- Support other languages ("llámame", "appelle-moi")?

**Q8.2: Should we use different keywords for WhatsApp vs SMS?**
- Or unified keyword detection across channels?

---

## 9. Media & Rich Messaging

**Q9.1: Should we support WhatsApp-specific features?**
WhatsApp supports:
- Rich media (images, audio, video, PDFs up to 16MB)
- Interactive buttons
- Location sharing
- Contact cards

For call-me:
- Text-only for v1?
- Support sending voice notes instead of text?
- Future: screenshots, code snippets?

**Q9.2: How do we handle incoming media from users?**
- Ignore media, only process text?
- Download and describe images to Claude?
- Save attachments for later?

---

## 10. Rate Limits & Costs

**Q10.1: What are the WhatsApp message limits?**
- Per-number sending limits
- Per-conversation limits
- How do limits affect fallback behavior?

**Q10.2: Cost comparison vs SMS:**
- WhatsApp typically cheaper internationally
- But requires templates for business-initiated messages
- Should we prefer WhatsApp over SMS for cost reasons?
- Or prefer SMS for simplicity?

---

## 11. Provider Interface Design

**Q11.1: Should we create a `MessageProvider` interface?**

Option A: Separate SMS and WhatsApp providers
```typescript
interface SMSProvider { sendSMS(...) }
interface WhatsAppProvider { sendWhatsApp(...) }
```

Option B: Unified messaging interface
```typescript
interface MessageProvider {
  sendMessage(to: string, body: string, channel: 'sms' | 'whatsapp'): Promise<string>;
}
```

Option C: Use Twilio Conversations API (abstracts channels)
```typescript
interface ConversationProvider {
  sendMessage(conversationSid: string, body: string): Promise<void>;
}
```

**Recommendation needed:** Which pattern fits the existing architecture?

**Q11.2: Do we need channel-specific config?**
```typescript
interface MessagingConfig {
  // Twilio credentials (shared)
  accountSid: string;
  authToken: string;

  // Channel-specific numbers
  smsPhoneNumber: string;
  whatsappPhoneNumber: string;  // Could be same as SMS

  // WhatsApp-specific
  whatsappMode: 'sandbox' | 'production';
  whatsappSandboxJoinCode?: string;
}
```

---

## 12. Error Handling

**Q12.1: What are the WhatsApp-specific errors?**
Common errors:
- User not registered on WhatsApp
- Opt-in required
- Template not approved
- Message rejected (spam detection)
- Rate limit exceeded

How should we handle each?

**Q12.2: Should we retry WhatsApp failures with SMS?**
- Automatic fallback?
- Ask Claude Code to decide?
- Report error and let user retry?

---

## 13. Testing & Development

**Q13.1: Can we test locally without Meta approval?**
- Sandbox mode supports testing
- Requires WhatsApp join code
- How do we document this for developers?

**Q13.2: What's in the test matrix?**
Current SMS design has 7 test scenarios. With WhatsApp:
- Voice → WhatsApp successful
- Voice → WhatsApp opt-in required → SMS fallback
- Voice → WhatsApp failed → SMS fallback
- User texts "call me" via WhatsApp
- User texts "call me" via SMS
- Mixed conversation (some WhatsApp, some SMS)
- Session timeout works across channels

---

## 14. Configuration & Environment

**Q14.1: What new environment variables do we need?**
```bash
# Do we need all of these?
CALLME_WHATSAPP_ENABLED=true
CALLME_WHATSAPP_MODE=sandbox  # or production
CALLME_WHATSAPP_PHONE_NUMBER=whatsapp:+14155238886
CALLME_WHATSAPP_SANDBOX_JOIN_CODE=join-abc123
CALLME_MESSAGING_FALLBACK_CHAIN=whatsapp,sms
```

**Q14.2: Backward compatibility:**
- Should the feature be opt-in (default disabled)?
- Or automatically enabled if WhatsApp credentials configured?

---

## 15. Documentation & User Experience

**Q15.1: How do we communicate channel switching to Claude Code?**
Current design returns `contactMode: 'voice' | 'sms'`

With WhatsApp:
```typescript
contactMode: 'voice' | 'whatsapp' | 'sms'
```

Should MCP responses include:
- Current channel
- Available channels
- Reason for channel switch?

**Q15.2: What does Claude Code need to know?**
- WhatsApp requires opt-in (show this in error messages?)
- Character limits (1600 for SMS, longer for WhatsApp?)
- Available features per channel?

---

## Summary: Critical Decisions Needed

**Must decide before implementation:**

1. **Conversations API vs Programmable Messaging** (Q3.1)
2. **Template strategy** - which templates, approval timeline (Q4.2, Q4.3)
3. **Fallback chain** - Voice → WhatsApp → SMS or other? (Q7.1)
4. **Opt-in handling** - how do we ensure compliance? (Q1.1, Q1.2)
5. **Provider interface design** - unified or separate? (Q11.1)

**Can decide during implementation:**

6. Rich media support (Q9.1, Q9.2)
7. Multi-language keyword detection (Q8.2)
8. Sandbox vs production mode switching (Q2.2)
9. Testing strategy (Q13.1, Q13.2)

**Can defer to later:**

10. Cost optimization strategies (Q10.2)
11. Advanced error handling (Q12.2)
12. Channel-specific features (Q9.1)

---

## Next Steps

1. Review these questions
2. Make architectural decisions for "Critical Decisions"
3. Update DESIGN-sms-fallback.md → DESIGN-messaging-fallback.md
4. Create implementation plan
5. Identify security review requirements
