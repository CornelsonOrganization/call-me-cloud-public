# Call-Me Cloud

A cloud-hosted phone call MCP server that lets Claude call the user for voice conversations.

## MCP Tools

### Phone Call Tools

- `initiate_call` - Start a new call with an initial message
- `continue_call` - Send a follow-up message and wait for response
- `speak_to_user` - Speak without waiting for a response
- `end_call` - End the call with a closing message

### WhatsApp Messaging

- `send_message` - Send a WhatsApp message and wait for user's reply (blocks until response received or 3-minute timeout)

## When to Use Phone Calls vs WhatsApp

### Use Phone Calls For:

- Complex decisions that need real-time discussion
- Clarifying ambiguous requirements
- Reporting completion of significant work
- When text would be too slow or cumbersome

### Use WhatsApp Messaging For:

- Fallback when phone calls fail (user unavailable, call not answered)
- Simple confirmations or brief updates that don't need voice
- When the user prefers text communication

**Automatic Fallback:** If a phone call attempt fails, WhatsApp is the preferred fallback method. The system has a 3-minute timeout window for transcript responses.

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

There are two ways to trigger GitHub Actions calls:

### 1. From a Local Claude Session (Programmatic)

If you're in a Claude Code session (terminal or desktop) with repo access, you can use the GitHub CLI to trigger a workflow programmatically:

```bash
gh workflow run call.yml \
  --repo OWNER/REPO \
  -f delay_minutes=5 \
  -f prompt="Description of what to discuss/work on" \
  -f branch="feat/branch-name"
```

This is useful when the user says something like "Schedule a call in 5 minutes to refactor the auth module" during an active session.

**Examples:**

User says: "Schedule a call in 5 minutes to refactor the auth module"
```bash
gh workflow run call.yml --repo user/repo \
  -f delay_minutes=5 \
  -f prompt="Refactor the auth module - discuss approach with user" \
  -f branch="feat/auth-refactor"
```

User says: "Have Claude call me tomorrow morning about the API design"
→ Use a longer delay or suggest they set up a cron schedule

### 2. Manual Trigger via GitHub UI (User-Initiated)

Users can also manually trigger calls directly through:
- **GitHub website**: Navigate to Actions → Call workflow → "Run workflow" button
- **GitHub mobile app**: Access repository → Actions → Call → Manual trigger

This approach is useful when:
- The user is away from their laptop but wants to schedule a call
- They want to trigger a call without opening a Claude session first
- They prefer using GitHub's UI over command-line tools

**What happens after trigger:**
Both methods spawn a new Claude session in GitHub Actions that will call the user after the specified delay, discuss the prompt, and commit changes to the specified branch.

## Environment Variables (for Claude Code on the web)

Configure these in your Claude Code web environment settings:

### Required

| Variable | Description |
|----------|-------------|
| `CALLME_API_KEY` | API key for authenticating requests to this server |
| `CALLME_USER_PHONE_NUMBER` | Your phone number (where calls are placed) |
| `CALLME_PHONE_ACCOUNT_SID` | Twilio Account SID |
| `CALLME_PHONE_AUTH_TOKEN` | Twilio Auth Token |
| `CALLME_PHONE_NUMBER` | The phone number to call from |
| `CALLME_OPENAI_API_KEY` | OpenAI API key for TTS and STT |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `CALLME_PUBLIC_URL` | auto | Public URL (auto-detected on Railway/Render) |
| `CALLME_PORT` | `3333` | Server port |
| `CALLME_TTS_VOICE` | `onyx` | OpenAI TTS voice |
| `CALLME_STT_MODEL` | `gpt-4o-transcribe` | OpenAI STT model |
| `CALLME_TRANSCRIPT_TIMEOUT_MS` | `180000` | Transcript timeout (3 min) |
