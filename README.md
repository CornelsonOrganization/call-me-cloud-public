# Call-Me Cloud

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/call-me-cloud)

**Voice conversations for AI agents.** Let Claude (or any AI) call you on the phone for real-time voice discussions.

Built for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) - works with Claude Code, Claude Desktop, and any MCP-compatible client.

## Features

- **Real-time voice calls** - AI initiates phone calls and has natural conversations
- **Barge-in support** - Interrupt the AI mid-sentence, just like a real conversation
- **Cloud-native** - No ngrok or tunneling needed; deploys to Railway/Render
- **Dual provider support** - Works with Twilio or Telnyx for phone services
- **Streaming TTS** - Low-latency text-to-speech with multiple voice options
- **Secure by default** - Webhook signature validation, token-based WebSocket auth

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Your Computer                                   │
│  ┌─────────────────┐                                                        │
│  │  Claude Code    │                                                        │
│  │  (MCP Client)   │────┐                                                   │
│  └─────────────────┘    │                                                   │
│           ▲             │ stdio                                             │
│           │             ▼                                                   │
│  ┌─────────────────┐                                                        │
│  │  MCP Server     │ (local)                                                │
│  │  mcp-client/    │                                                        │
│  └────────┬────────┘                                                        │
└───────────┼─────────────────────────────────────────────────────────────────┘
            │ HTTPS (REST API)
            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Cloud (Railway / Render)                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      call-me-cloud server                            │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │   │
│  │  │ REST API │  │ Webhook  │  │WebSocket │  │ Audio Processing │    │   │
│  │  │ Handler  │  │ Handler  │  │ Server   │  │ (resample/encode)│    │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└───────────┬─────────────────────────────────┬───────────────────────────────┘
            │                                 │
            ▼                                 ▼
     ┌─────────────┐                  ┌─────────────┐
     │   Twilio    │                  │   OpenAI    │
     │  or Telnyx  │                  │  TTS / STT  │
     │             │                  │  Realtime   │
     └──────┬──────┘                  └─────────────┘
            │
            ▼
     ┌─────────────┐
     │ Your Phone  │
     │   📱        │
     └─────────────┘
```

## Quick Start

### 1. Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/riverscornelson/call-me-cloud)

Or manually:
1. Fork this repo
2. Connect to [Railway](https://railway.app)
3. Add environment variables (see [Configuration](#configuration))

### 2. Configure Phone Provider

> **Note:** Phone provider setup takes ~1 hour. You'll be switching between portals and copying credentials back and forth. It's not hard, just fiddly.

**Twilio:**
1. Get a phone number from [Twilio Console](https://console.twilio.com)
2. Set webhook URL to `https://YOUR-RAILWAY-URL/twiml` (POST)

**Telnyx:**
1. Get a phone number from [Telnyx Portal](https://portal.telnyx.com)
2. Create a TeXML Application with webhook `https://YOUR-RAILWAY-URL/twiml`

### 3. Install MCP Client

```bash
cd mcp-client
bun install
```

### 4. Add to Claude Code

```bash
claude mcp add call-me -- bun run /path/to/call-me-cloud/mcp-client/index.ts
```

Set environment variables in your Claude config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "call-me": {
      "command": "bun",
      "args": ["run", "/path/to/call-me-cloud/mcp-client/index.ts"],
      "env": {
        "CALLME_CLOUD_URL": "https://your-app.railway.app",
        "CALLME_API_KEY": "your-secret-api-key"
      }
    }
  }
}
```

### 5. Test It

```
You: Call me to discuss the project status
Claude: [Initiates phone call]
```

## Configuration

### Cloud Server Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CALLME_API_KEY` | Yes | - | Secret key for API authentication |
| `CALLME_PHONE_PROVIDER` | No | `twilio` | Phone provider: `twilio` or `telnyx` |
| `CALLME_PHONE_ACCOUNT_SID` | Yes | - | Twilio Account SID or Telnyx Connection ID |
| `CALLME_PHONE_AUTH_TOKEN` | Yes | - | Twilio Auth Token or Telnyx API Key |
| `CALLME_PHONE_NUMBER` | Yes | - | Your Twilio/Telnyx phone number |
| `CALLME_USER_PHONE_NUMBER` | Yes | - | Your personal phone number to receive calls |
| `CALLME_OPENAI_API_KEY` | Yes | - | OpenAI API key for TTS/STT |
| `CALLME_TTS_VOICE` | No | `onyx` | TTS voice (see [Voices](#available-voices)) |
| `CALLME_TELNYX_PUBLIC_KEY` | Telnyx | - | Telnyx webhook signing public key |
| `OPENAI_API_BASE_URL` | No | - | Regional OpenAI endpoint (e.g., `us.api.openai.com`) |

### MCP Client Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CALLME_CLOUD_URL` | Yes | Your Railway/Render deployment URL |
| `CALLME_API_KEY` | Yes | Same API key as cloud server |

### Available Voices

OpenAI TTS voices: `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`

## API Reference

All endpoints require `Authorization: Bearer <API_KEY>` header.

### Initiate Call
```http
POST /api/call
Content-Type: application/json

{"message": "Hey, I wanted to discuss the project status."}
```

**Response:**
```json
{
  "callId": "call-1-1234567890",
  "response": "User's spoken response",
  "interrupted": false
}
```

### Continue Conversation
```http
POST /api/call/:callId/continue
Content-Type: application/json

{"message": "What about the timeline?"}
```

### Speak Without Waiting
```http
POST /api/call/:callId/speak
Content-Type: application/json

{"message": "Let me explain..."}
```

### End Call
```http
POST /api/call/:callId/end
Content-Type: application/json

{"message": "Thanks, talk to you later!"}
```

**Response:**
```json
{"durationSeconds": 45}
```

### Health Check
```http
GET /health
```

## MCP Tools

When used with Claude Code or other MCP clients:

| Tool | Description |
|------|-------------|
| `initiate_call` | Start a new phone call with an initial message |
| `continue_call` | Send a follow-up message and wait for response |
| `speak_to_user` | Speak without waiting for a response |
| `end_call` | End the call with a closing message |

## Costs

| Service | Approximate Cost |
|---------|------------------|
| Railway | Free tier: $5/month credit |
| Twilio | ~$0.014/min outbound |
| Telnyx | ~$0.007/min outbound |
| OpenAI TTS | ~$15/1M characters |
| OpenAI Realtime STT | ~$0.06/min |

**Typical 1-minute call:** ~$0.05-0.08

## Self-Hosting with Docker

> **Note:** Docker support is a work in progress. The basics should work, but this hasn't been thoroughly tested yet. Contributions welcome!

```bash
docker build -t call-me-cloud .
docker run -p 3333:3333 --env-file .env call-me-cloud
```

Or with docker-compose:

```bash
docker-compose up
```

## Troubleshooting

### "Could not reach cloud server"
- Verify `CALLME_CLOUD_URL` includes `https://`
- Check Railway deployment is running
- Ensure `CALLME_API_KEY` matches on both client and server

### Call connects but no audio
- Verify OpenAI API key has Realtime API access
- Check Railway logs for WebSocket connection errors
- Ensure `CALLME_TTS_VOICE` is a valid voice name

### Twilio webhook errors
- Webhook URL must be `https://YOUR-URL/twiml` (not `/api/call`)
- Check Twilio Console for webhook delivery logs
- Verify `CALLME_PHONE_AUTH_TOKEN` is correct

### Telnyx webhook errors
- Ensure `CALLME_TELNYX_PUBLIC_KEY` is set (required for signature validation)
- Check TeXML Application webhook configuration
- Verify webhook URL in Telnyx Portal

### Call cuts off early
- Check Railway resource limits (memory/CPU)
- Increase `CALLME_TRANSCRIPT_TIMEOUT_MS` for longer responses

## Security

- **API Authentication**: Bearer token required for all API endpoints
- **Webhook Validation**: Twilio (HMAC-SHA1) and Telnyx (Ed25519) signatures verified
- **WebSocket Auth**: Cryptographically secure tokens with timing-safe comparison
- **No CORS**: Server-to-server only; browser access intentionally disabled

See [CLAUDE.md](CLAUDE.md) for security implementation details.

## Limitations

- **Outbound calls only** - Claude calls you; you cannot call Claude. This is intentional for security reasons: allowing inbound calls to wake up a terminal session with elevated permissions would be dangerous when you can't actively monitor it.
- **Miss the call, miss the conversation** - If you don't answer, the conversation stops. There's no voicemail or retry. Use `claude --resume` when you're back at your laptop to continue.

## Use Cases

See [docs/USE-CASES.md](docs/USE-CASES.md) for 10 detailed storyboards showing when voice communication adds value:

- **Missed Call Recovery** - Seamless voice-to-SMS continuity
- **Build Watcher** - "Call me when CI finishes"
- **Dangerous Operation Approval** - Voice confirmation before `git push --force`
- **Driving Developer** - Productive commute time
- **Accessibility-First** - Voice-first coding for RSI
- And 5 more...

## Roadmap

### SMS Fallback (pending Twilio approval)

When calls go unanswered, automatically fall back to SMS and continue the conversation via text.

| Aspect | Behavior |
|--------|----------|
| Trigger | After configurable timeout (`CALLME_SMS_TIMEOUT_SECONDS` env var) |
| Conversation | Full text conversation until user says "call me" |
| Detection | Fuzzy matching ("call me", "can you call", "let's talk", "phone me") |
| Rate limiting | None |

**Flow:**
1. Call initiates, rings for configured timeout
2. No answer → SMS sent with the original message
3. User can reply via text indefinitely
4. User texts "call me" (or similar) → Claude calls back
5. 7-minute inactivity → session closes (resume with `claude --resume`)

**Status:** Requires Twilio A2P 10DLC registration. Form filed, awaiting approval.

See [DESIGN-sms-fallback.md](DESIGN-sms-fallback.md) for technical details.

### Scheduled & Proactive Calls (planned)

Let Claude schedule callbacks and proactively call when events occur.

| Aspect | Behavior |
|--------|----------|
| Time-based | "Call me in 30 minutes" |
| Event-based | "Call me when the Railway build finishes" |
| Condition-based | "Call me if tests fail" |
| Initiation | Both user-requested and Claude-proposed |
| Persistence | Ephemeral (dies with session) for v1 |

**Examples:**
- "Push this and call me when CI finishes"
- "Call me in 10 minutes to review the PR"
- "If the deployment fails, call me"

**Event sources (v1):** Railway webhooks
**Event sources (future):** GitHub Actions, custom webhooks

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE)

## Acknowledgments

- Built with [Bun](https://bun.sh) for fast TypeScript execution
- Phone services by [Twilio](https://twilio.com) and [Telnyx](https://telnyx.com)
- Speech services by [OpenAI](https://openai.com)
- Designed for the [Model Context Protocol](https://modelcontextprotocol.io)
