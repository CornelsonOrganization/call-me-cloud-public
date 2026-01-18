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
| `CALLME_TTS_MODEL` | `gpt-4o-mini-tts` | OpenAI TTS model (`gpt-4o-mini-tts` or `tts-1`) |
| `CALLME_TTS_VOICE` | `ballad` | OpenAI TTS voice |
| `CALLME_TTS_INSTRUCTIONS` | - | Voice style instructions (gpt-4o-mini-tts only) |
| `CALLME_STT_MODEL` | `gpt-4o-transcribe` | OpenAI STT model |
| `CALLME_TRANSCRIPT_TIMEOUT_MS` | `180000` | Transcript timeout (3 min) |

## Server Setup

1. **Deploy the server**: Use Railway, Heroku, or any cloud provider
2. **Configure environment variables**: Set the required variables above  
3. **Get your API key**: Generate a secure random key for `CALLME_API_KEY`
4. **Set up Twilio**: Get phone numbers and API credentials
5. **Test the deployment**: Verify `/health` endpoint is accessible

## MCP Configuration

Add to your Claude Code or Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "call-me-cloud": {
      "command": "npx",
      "args": ["-y", "call-me-cloud-mcp"],
      "env": {
        "CALLME_CLOUD_URL": "https://your-server.railway.app",
        "CALLME_API_KEY": "your-api-key"
      }
    }
  }
}
```

Replace `your-server.railway.app` with your actual server URL and `your-api-key` with your generated API key.