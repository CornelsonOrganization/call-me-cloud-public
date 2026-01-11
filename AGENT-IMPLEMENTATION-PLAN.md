# Multi-Agent Implementation Plan: WhatsApp Fallback Feature

**Date:** 2026-01-11
**Status:** Awaiting User Approval
**Goal:** Complete WhatsApp fallback phases 2-6 using specialized agents with quality review

---

## Overview

This plan uses Claude's Task tool with specialized agents to implement the remaining WhatsApp fallback phases. Each phase will be handled by appropriate agents with a final quality review.

**Current Status:** Phase 1 complete (PR #7)
**Remaining Work:** Phases 2-6 (~1,000 LOC)
**Approach:** Simple MVP - implement only CRITICAL and essential HIGH priority items

---

## Agent Workflow

### Phase Structure

Each phase follows this pattern:

1. **Plan Agent** - Designs implementation approach
2. **General-Purpose Agent** - Implements the code
3. **Bash Agent** - Runs tests/builds when needed
4. **Explore Agent** - Reviews code quality and security
5. **Human Approval** - User confirms via phone call before merge

---

## Phase 2: Session State & Timeouts

**Priority:** CRITICAL (C2, C5) + HIGH (H2)
**Estimated LOC:** 150-200
**Agent Assignments:**

1. **Plan Agent**
   - Review current session management in `src/phone-call.ts`
   - Design `SessionManager` class with secure phone mapping
   - Plan event-driven timeout system
   - Plan 24-hour window tracking

2. **General-Purpose Agent**
   - Create `SessionManager` class
   - Remove `phoneNumber` from `SessionState` interface
   - Implement `conversationToPhone` and `phoneToConversation` private Maps
   - Add methods: `getPhoneForConversation()`, `getConversationForPhone()`
   - Implement `refreshInactivityTimeout()` with `setTimeout`/`clearTimeout`
   - Add `inactivityTimer` and `whatsappSessionTimer` to session state
   - Implement `whatsappSessionExpiry` timestamp tracking
   - Add phone number hashing for any necessary logging

3. **Explore Agent (Quality Review)**
   - Verify no phone numbers in logs or session state
   - Check timer cleanup to prevent memory leaks
   - Verify event-driven timeout logic
   - Review Map-based phone number storage

4. **Call User** - Confirm Phase 2 complete and get approval to continue

**Key Deliverables:**
- `SessionManager` class with secure phone mapping
- Event-driven timeouts (no polling)
- 24-hour WhatsApp session window tracking

---

## Phase 3: Call Timeout Detection

**Priority:** HIGH (H3)
**Estimated LOC:** 120-140
**Agent Assignments:**

1. **Plan Agent**
   - Review Twilio status callback webhook handlers
   - Design fallback trigger logic
   - Plan WhatsApp conversation creation flow

2. **General-Purpose Agent**
   - Modify webhook handlers in `src/phone-call.ts`
   - Detect call statuses: `no-answer`, `busy`, `canceled`, `failed`
   - Trigger WhatsApp fallback on timeout
   - Create conversation via messaging provider
   - Send template message with sandbox join instructions
   - Transition session to WhatsApp mode

3. **Bash Agent**
   - Run build and check for type errors

4. **Explore Agent (Quality Review)**
   - Verify all timeout scenarios handled
   - Check template message format
   - Review session mode transition logic

5. **Call User** - Confirm Phase 3 complete and get approval to continue

**Key Deliverables:**
- Call timeout detection working
- Automatic WhatsApp fallback triggered
- Template message sent correctly

---

## Phase 4: WhatsApp Webhook + Security

**Priority:** CRITICAL (C1, C3, C4, C6, C7)
**Estimated LOC:** 200-260
**Agent Assignments:**

1. **Plan Agent**
   - Design `/whatsapp` webhook endpoint
   - Plan security layer (signature validation, rate limiting)
   - Design message routing via conversation SID

2. **General-Purpose Agent (Security Focus)**
   - Add `/whatsapp` endpoint to `src/index.ts`
   - Implement webhook signature validation (C1)
   - Create `RateLimiter` class with token bucket algorithm (C3)
   - Implement uniform webhook responses (C4)
   - Add restrictive keyword detection (C6)
   - Implement input validation (C7)
   - Route messages to sessions via conversation SID

3. **Bash Agent**
   - Run build and check for errors

4. **Explore Agent (SECURITY REVIEW)**
   - Audit webhook signature validation
   - Test rate limiter thresholds
   - Verify uniform responses (no session enumeration)
   - Check keyword detection patterns (no false positives)
   - Review input validation (injection prevention)
   - Verify no timing attacks or information leaks

5. **Call User** - Confirm Phase 4 complete with CRITICAL security review

**Key Deliverables:**
- `/whatsapp` endpoint with full security
- Webhook signature validation working
- Rate limiting preventing DoS
- Message routing to correct sessions
- Keyword detection for "call me" requests

---

## Phase 5: MCP Client Updates

**Priority:** HIGH (H4)
**Estimated LOC:** 60-80
**Agent Assignments:**

1. **Plan Agent**
   - Review current MCP client in `/mcp-client/index.ts`
   - Design response field updates

2. **General-Purpose Agent**
   - Add `contactMode: 'voice' | 'whatsapp'` to responses
   - Add `whatsappSessionWindow` object with status/expiry
   - Add `conversationSid` field
   - Handle timeout notifications
   - Update tool response types

3. **Explore Agent (Quality Review)**
   - Verify response types match API
   - Check Claude Code receives correct session info

4. **Call User** - Confirm Phase 5 complete

**Key Deliverables:**
- MCP client shows current contact mode
- Claude Code aware of WhatsApp session window
- Timeout notifications work

---

## Phase 6: Testing & Documentation

**Priority:** HIGH (H8) + MEDIUM (M6)
**Estimated LOC:** 300-400
**Agent Assignments:**

1. **Plan Agent**
   - Design test plan (focus on CRITICAL security features)
   - Plan manual testing approach with Twilio sandbox

2. **General-Purpose Agent**
   - Write unit tests for rate limiter
   - Write unit tests for keyword detection
   - Write unit tests for input validation
   - Write integration test for webhook flow
   - Update README with configuration
   - Document sandbox setup steps

3. **Bash Agent**
   - Run all tests
   - Run build
   - Check for type errors

4. **Explore Agent (FINAL QUALITY REVIEW - "SAVAGE MODE")**
   - Run all tests and verify 100% pass
   - Security audit checklist:
     - [ ] All 7 CRITICAL actions implemented
     - [ ] No phone numbers in logs
     - [ ] Webhook signature validation working
     - [ ] Rate limiting tested
     - [ ] Input validation prevents injection
     - [ ] No timing attacks possible
     - [ ] No session enumeration possible
   - Code quality review:
     - [ ] TypeScript strict mode passes
     - [ ] No memory leaks (timer cleanup verified)
     - [ ] Error handling comprehensive
     - [ ] Logging follows privacy policy
   - Integration testing:
     - [ ] Manual test with Twilio sandbox
     - [ ] Voice → WhatsApp fallback works
     - [ ] WhatsApp → Voice "call me" works
     - [ ] 24-hour window warnings work
     - [ ] Session cleanup works

5. **Call User** - Final approval before merge

**Key Deliverables:**
- Test suite with 80%+ coverage on critical paths
- Manual testing verified with sandbox
- Security checklist complete
- Documentation updated

---

## Success Criteria (MVP)

### MUST HAVE (Blocking)
- [ ] All 7 CRITICAL actions (C1-C7) implemented
- [ ] No phone numbers in logs or session state
- [ ] Webhook signature validation working
- [ ] Rate limiting prevents DoS
- [ ] Voice → WhatsApp fallback working
- [ ] Security review passed

### SHOULD HAVE (Important)
- [ ] 24-hour window tracking working
- [ ] MCP client shows contact mode
- [ ] Keyword detection for "call me" works
- [ ] Basic test coverage on security features

### WON'T HAVE (Deferred)
- ❌ Redis persistence (in-memory OK for MVP)
- ❌ SMS fallback (WhatsApp only)
- ❌ Multi-language keyword detection
- ❌ Monitoring dashboards
- ❌ Production upgrade guide (sandbox only for now)

---

## Execution Plan

### Step 1: Sequential Phase Implementation
Run phases 2-6 sequentially. Each phase:
1. Spawn Plan agent to design
2. Spawn Build agent to implement
3. Spawn Explore agent for quality review
4. Call user for approval
5. Commit to branch `claude/call-20260111-192146`

### Step 2: Quality Gates
- After Phase 2: Verify secure session management
- After Phase 4: FULL security audit (most critical)
- After Phase 6: Final "savage" review before merge

### Step 3: User Checkpoints
Call user after each phase with:
- Summary of what was implemented
- Any issues or decisions needed
- Confirmation to proceed to next phase

---

## Risk Mitigation

**Risk:** Agents might over-engineer
**Mitigation:** Explicit "MVP only" instruction in each agent prompt

**Risk:** Security gaps in Phase 4
**Mitigation:** Dedicated security-focused review by Explore agent

**Risk:** Integration issues between phases
**Mitigation:** Each phase runs build/tests before proceeding

**Risk:** User loses track of progress
**Mitigation:** Phone call after each phase

---

## Estimated Timeline

- **Phase 2:** 1-2 hours (agents + review + call)
- **Phase 3:** 1-2 hours
- **Phase 4:** 2-3 hours (security critical)
- **Phase 5:** 30-60 minutes
- **Phase 6:** 1-2 hours (testing + review)

**Total:** 6-10 hours for all phases with agent automation

---

## Next Steps

1. **User approves this plan via phone call**
2. **Execute Phase 2** with Plan → Build → Review → Call workflow
3. **Continue through Phase 6** with checkpoints
4. **Final merge** after Phase 6 approval
5. **Create PR** to merge into main

---

**End of Plan**
