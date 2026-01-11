# Call-Me Cloud

A cloud-hosted phone call MCP server that lets Claude call the user for voice conversations.

## MCP Tools

- `initiate_call` - Start a new call with an initial message
- `continue_call` - Send a follow-up message and wait for response
- `speak_to_user` - Speak without waiting for a response
- `end_call` - End the call with a closing message

## When to Call

- Complex decisions that need real-time discussion
- Clarifying ambiguous requirements
- Reporting completion of significant work
- When text would be too slow or cumbersome

## Call Before (Required Approval)

**Always call and get explicit approval before:**

- `git push origin main` or `git push origin master`
- `git push --force` (any branch)
- `git reset --hard`
- `rm -rf` or deleting multiple files
- Any destructive or irreversible operation

Example: "Hey, I'm ready to push to main. The changes include X, Y, Z. Should I go ahead?"

## Call Best Practices

1. **Keep messages concise** - Phone audio is harder to follow than text
2. **One topic per message** - Don't overload with multiple questions
3. **Always confirm before hanging up** - Say something like "Is there anything else, or should I hang up?" before using `end_call`. This catches any transcription errors the user may need to correct.
4. **Use continue_call for dialogue** - Don't end prematurely; have a real conversation

## Example Flow

```
initiate_call: "Hey, I finished the security fixes. Want me to walk through what changed?"
[user responds]
continue_call: "Got it. Any other questions about the implementation?"
[user responds]
end_call: "Sounds good. Anything else before I hang up? ... Great, talk to you later!"
```

## Scheduling Calls via GitHub Actions

If the user asks to "schedule a call" or "call me in X minutes", use the GitHub CLI to trigger a workflow:

```bash
gh workflow run scheduled-call.yml \
  --repo OWNER/REPO \
  -f delay_minutes=5 \
  -f prompt="Description of what to discuss/work on" \
  -f branch="feat/branch-name"
```

This spawns a new Claude session that will call the user after the delay, discuss the prompt, and commit changes to the specified branch.

**Examples:**

User says: "Schedule a call in 5 minutes to refactor the auth module"
```bash
gh workflow run scheduled-call.yml --repo user/repo \
  -f delay_minutes=5 \
  -f prompt="Refactor the auth module - discuss approach with user" \
  -f branch="feat/auth-refactor"
```

User says: "Have Claude call me tomorrow morning about the API design"
→ Use a longer delay or suggest they set up a cron schedule

## Environment Variables (for Claude Code on the web)

Configure these in your Claude Code web environment settings:

### Required

| Variable | Description |
|----------|-------------|
| `CALLME_API_KEY` | API key for authenticating requests to this server |
| `CALLME_USER_PHONE_NUMBER` | Your phone number (where calls are placed) |
| `CALLME_PHONE_ACCOUNT_SID` | Twilio Account SID or Telnyx Connection ID |
| `CALLME_PHONE_AUTH_TOKEN` | Twilio Auth Token or Telnyx API Key |
| `CALLME_PHONE_NUMBER` | The phone number to call from |
| `CALLME_OPENAI_API_KEY` | OpenAI API key for TTS and STT |

### Provider-Specific

| Variable | Description |
|----------|-------------|
| `CALLME_PHONE_PROVIDER` | `twilio` or `telnyx` (default: `telnyx`) |
| `CALLME_TELNYX_PUBLIC_KEY` | Required for Telnyx webhook signature verification |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `CALLME_PUBLIC_URL` | auto | Public URL (auto-detected on Railway/Render) |
| `CALLME_PORT` | `3333` | Server port |
| `CALLME_TTS_VOICE` | `onyx` | OpenAI TTS voice |
| `CALLME_STT_MODEL` | `gpt-4o-transcribe` | OpenAI STT model |
| `CALLME_TRANSCRIPT_TIMEOUT_MS` | `180000` | Transcript timeout (3 min) |
