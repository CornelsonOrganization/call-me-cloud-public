# Call-Me Cloud

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/call-me-cloud)

**Voice conversations for AI agents.** Let Claude call you on the phone for real-time discussions - even when your laptop is off.

Built for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) - works with Claude Code, Claude Desktop, GitHub Actions, and any MCP-compatible client.

## The Problem

You kick off an agent task - a refactor, a build, a code review - and now you're **tethered to your laptop**. You can't step away. What if it heads in the wrong direction? What if it needs a decision? You end up watching, waiting, losing productive time to "laptop anxiety."

## The Solution

Call-Me-Cloud eliminates the tether. Start a task, step away, and Claude calls when it needs you. Voice-first decision making means you can:

- **Design features while vacuuming** - Real productivity during chores
- **Review code during your commute** - Turn driving time into work time
- **Approve deployments from anywhere** - No laptop required
- **Stop watching progress bars** - Let Claude watch them for you

This tool was built using itself - most commits came from phone conversations with Claude rather than traditional coding sessions. It's not perfect, but it demonstrates how much leverage these tools create.

## Quick Start

**New to this project?** → See **[QUICKSTART.md](QUICKSTART.md)** for setup with a coding agent

**Already set up?** → Jump to [Example Usage](#example-usage)

**Setup time:** One afternoon to deploy and configure

## Why Voice?

Text is great for code. Voice is better for:
- **Eliminating laptop anxiety** - Start work, walk away, Claude calls when done
- **Dangerous operations** - Voice confirmation prevents catastrophic mistakes
- **Complex decisions** - Discuss trade-offs in real-time
- **Parallel workflows** - Talk while your hands are busy

See [15 detailed use cases](docs/USE-CASES.md) with storyboards.

## Example Usage

### Call from GitHub Actions (Laptop Off)

```bash
# Trigger a delayed call
gh workflow run call.yml \
  -f delay_minutes=10 \
  -f prompt="I'm going for a run. Call me to discuss the API design"

# Monitor a build
gh workflow run call.yml \
  -f prompt="Watch the CI build and call me when it finishes"

# Get approval before dangerous operations
gh workflow run call.yml \
  -f prompt="Review the database migration and call me before running it"
```

### Call from Local Claude Session (Quick)

```
You: Call me to discuss the authentication refactor

Claude: [Initiates phone call]
```

### Real Conversation Example

**You trigger:**
```bash
gh workflow run call.yml \
  -f prompt="Review PR #123 and call me with concerns"
```

**15 minutes later, Claude calls:**
```
Claude: "Hey, I reviewed PR #123. Overall looks solid, but I have
         concerns about error handling in auth-controller.ts line 89.
         The catch block doesn't log the error context. Want to discuss?"

You:    "What would you recommend?"

Claude: "I'd add structured logging with the user ID and request path.
         Should I make that change now?"

You:    "Yes, do it"

Claude: "Done. Pushed to the PR branch. Anything else?"

You:    "No, looks good"

Claude: "Great, hanging up now. Talk later!"
```

**Result:** PR updated with improved error handling, all while you were away from your laptop.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Your Computer                              │
│  ┌──────────────┐         ┌───────────────┐│
│  │ Claude Code  │◄─stdio──┤  MCP Client   ││
│  └──────────────┘         └───────┬───────┘│
└────────────────────────────────────┼────────┘
                                     │ HTTPS
┌────────────────────────────────────┼────────┐
│  Railway/Cloud                     ▼        │
│  ┌─────────────────────────────────────┐   │
│  │  call-me-cloud server               │   │
│  │  • REST API  • WebSocket            │   │
│  │  • Webhooks  • Audio Processing     │   │
│  └──────┬────────────────────┬─────────┘   │
└─────────┼────────────────────┼─────────────┘
          │                    │
          ▼                    ▼
   ┌──────────┐         ┌──────────┐
   │  Twilio  │         │  OpenAI  │
   │  📞      │         │  🎤 🔊   │
   └─────┬────┘         └──────────┘
         │
         ▼
   ┌──────────┐
   │ Your 📱  │
   └──────────┘
```

## Features

- ✅ **Interrupt naturally** - Cut Claude off mid-sentence
- ✅ **Call from anywhere** - GitHub Actions means no laptop needed
- ✅ **No tunneling** - Cloud-native, no ngrok
- ✅ **Low latency** - Streaming TTS for responsive conversations
- ✅ **Secure** - Webhook validation and token auth built in

## Setup

### Prerequisites

You'll need accounts with:
- **[Railway](https://railway.app)** - Free tier: $5/month credit
- **[Twilio](https://twilio.com)** - ~$1/mo phone + $0.014/min calls
- **[OpenAI](https://platform.openai.com)** - ~$0.06/min for speech
- **[Anthropic](https://console.anthropic.com)** - For GitHub Actions (usage-based)

### Recommended: Setup with a Coding Agent

1. Clone this repo
2. Start a Claude Code session
3. Ask: *"Help me deploy call-me-cloud to Railway and set up Twilio"*

The agent will guide you through account creation, environment variables, and testing.

**Full guide:** [QUICKSTART.md](QUICKSTART.md)

### Manual Setup

<details>
<summary>Deploy to Railway (click to expand)</summary>

1. Click: [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/CornelsonOrganization/call-me-cloud-public)

2. Set environment variables:
   ```bash
   CALLME_API_KEY=<generate with: openssl rand -base64 32>
   CALLME_PHONE_ACCOUNT_SID=<from Twilio console>
   CALLME_PHONE_AUTH_TOKEN=<from Twilio console>
   CALLME_PHONE_NUMBER=<Twilio number: +1XXXYYYZZZZ>
   CALLME_USER_PHONE_NUMBER=<your number: +1XXXYYYZZZZ>
   CALLME_OPENAI_API_KEY=<from OpenAI>
   ```

3. Deploy and note your URL: `https://your-app.railway.app`

</details>

<details>
<summary>Configure Twilio (click to expand)</summary>

1. Get a phone number from [Twilio Console](https://console.twilio.com)
2. Set webhook URL to `https://YOUR-RAILWAY-URL/twiml` (POST)
3. Save and test

</details>

<details>
<summary>GitHub Actions Integration (click to expand)</summary>

1. Copy workflow file:
   ```bash
   mkdir -p .github/workflows
   curl -o .github/workflows/call.yml \
     https://raw.githubusercontent.com/CornelsonOrganization/call-me-cloud-public/main/.github/workflows/call.yml
   ```

2. Add GitHub Secrets (Settings → Secrets → Actions):
   - `ANTHROPIC_API_KEY`
   - `CALLME_API_KEY`
   - `CALLME_CLOUD_URL`

3. Trigger:
   ```bash
   gh workflow run call.yml -f prompt="Your task here"
   ```

</details>

<details>
<summary>Local MCP Client (click to expand)</summary>

1. Install dependencies:
   ```bash
   cd mcp-client && bun install
   ```

2. Add to Claude config (`~/.claude.json`):
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

3. Test:
   ```
   You: Call me to discuss the project
   Claude: [Initiates call]
   ```

</details>

## Use Cases

Real-world scenarios where voice shines:

| Scenario | Example |
|----------|---------|
| **Build Watcher** | "Call me when the 15-min CI build finishes" |
| **Dangerous Operations** | "I'm about to force push to main - confirm first?" |
| **Code Review** | "Review PR #89 and discuss concerns while I'm driving" |
| **Complex Explanations** | Walking through legacy authentication flow |
| **Missed Call Recovery** | SMS fallback when you don't answer |
| **Meeting-to-Spec** | Turn meeting notes into specs during commute |

**See [docs/USE-CASES.md](docs/USE-CASES.md) for 15 detailed storyboards**

## Configuration Reference

### Cloud Server (Railway)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CALLME_API_KEY` | ✅ | - | Auth token (generate with `openssl rand -base64 32`) |
| `CALLME_PHONE_ACCOUNT_SID` | ✅ | - | Twilio Account SID |
| `CALLME_PHONE_AUTH_TOKEN` | ✅ | - | Twilio Auth Token |
| `CALLME_PHONE_NUMBER` | ✅ | - | Twilio number (+1XXXYYYZZZZ) |
| `CALLME_USER_PHONE_NUMBER` | ✅ | - | Your phone (+1XXXYYYZZZZ) |
| `CALLME_OPENAI_API_KEY` | ✅ | - | OpenAI API key |
| `CALLME_TTS_MODEL` | ❌ | `gpt-4o-mini-tts` | TTS model |
| `CALLME_TTS_VOICE` | ❌ | `coral` | Voice (see [voices](#voices)) |
| `CALLME_TTS_INSTRUCTIONS` | ❌ | - | Voice style, e.g. "Speak cheerfully" |

### MCP Client (Local)

| Variable | Required | Description |
|----------|----------|-------------|
| `CALLME_CLOUD_URL` | ✅ | Railway URL |
| `CALLME_API_KEY` | ✅ | Same as server |

### GitHub Actions

Add as Repository Secrets:
- `ANTHROPIC_API_KEY`
- `CALLME_API_KEY`
- `CALLME_CLOUD_URL`

### Voices

**gpt-4o-mini-tts** (default): `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`, `marin`, `cedar`

**tts-1**: `alloy`, `echo`, `fable`, `nova`, `onyx`, `shimmer`

## API Reference

All endpoints require `Authorization: Bearer <API_KEY>` header.

### Initiate Call
```bash
curl -X POST https://your-app.railway.app/api/call \
  -H "Authorization: Bearer $CALLME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hey, wanted to discuss the project status"}'
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
```bash
curl -X POST https://your-app.railway.app/api/call/CALL_ID/continue \
  -H "Authorization: Bearer $CALLME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "What about the timeline?"}'
```

### Speak (No Wait)
```bash
curl -X POST https://your-app.railway.app/api/call/CALL_ID/speak \
  -H "Authorization: Bearer $CALLME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Let me explain the approach..."}'
```

### End Call
```bash
curl -X POST https://your-app.railway.app/api/call/CALL_ID/end \
  -H "Authorization: Bearer $CALLME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Thanks, talk later!"}'
```

## MCP Tools

Available when using Claude Code or MCP-compatible clients:

| Tool | Description |
|------|-------------|
| `initiate_call` | Start a phone call with an initial message |
| `continue_call` | Send message and wait for response |
| `speak_to_user` | Speak without waiting |
| `end_call` | End call with closing message |

## GitHub Actions Base Prompts

Select Claude's persona with the `base_prompt` input:

| Preset | Best For |
|--------|----------|
| `default` | General development |
| `office-mode` | Creating docs, slides, spreadsheets |
| `crowe-studio` | Branded documents (9 Formatting Basics) |
| `power-platform` | Power Apps/Automate work |
| `meeting-notes` | Turning discussions into specs |
| `code-review` | PR reviews with mentorship |

**Usage:**
```bash
gh workflow run call.yml \
  -f base_prompt="power-platform" \
  -f prompt="Deploy the order processing flow"
```

**Create custom prompts:** Add `.github/base-prompts/my-prompt.md` to your repo.

**Full guide:** [docs/github-actions-integration.md](docs/github-actions-integration.md)

## Costs

| Service | Approximate Cost |
|---------|------------------|
| Railway | Free tier: $5/month credit |
| Twilio | ~$1/mo + $0.014/min outbound |
| OpenAI | ~$0.06/min (TTS + STT) |

**Typical 1-minute call:** ~$0.05-0.08

## Troubleshooting

### "Could not reach cloud server"
- Verify `CALLME_CLOUD_URL` includes `https://`
- Check Railway deployment is running
- Ensure `CALLME_API_KEY` matches on client and server

### Call connects but no audio
- Verify OpenAI API key has Realtime API access
- Check Railway logs for WebSocket errors
- Ensure `CALLME_TTS_VOICE` is valid

### Twilio webhook errors
- URL must be `https://YOUR-URL/twiml` (not `/api/call`)
- Check Twilio Console webhook logs
- Verify `CALLME_PHONE_AUTH_TOKEN` is correct

**More help:** Work with a coding agent - they can check logs and debug in real-time.

## Security

- ✅ **API Authentication** - Bearer token required
- ✅ **Webhook Validation** - Twilio HMAC-SHA1 signatures verified
- ✅ **WebSocket Auth** - Cryptographically secure tokens
- ✅ **No CORS** - Server-to-server only

See [CLAUDE.md](CLAUDE.md) for implementation details.

## Limitations

- **Outbound calls only** - Claude calls you (not the reverse, for security)
- **No voicemail** - If you miss the call, conversation stops (use `claude --resume`)

## Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Setup with coding agent (recommended)
- **[docs/USE-CASES.md](docs/USE-CASES.md)** - 15 detailed scenarios
- **[docs/github-actions-integration.md](docs/github-actions-integration.md)** - Advanced workflows
- **[docs/PLUGINS.md](docs/PLUGINS.md)** - Plugin system
- **[CLAUDE.md](CLAUDE.md)** - Developer guide for agents

## Roadmap

### ✅ GitHub Actions Integration
**Status:** Shipped January 2026

Claude can call you from GitHub Actions, even when your laptop is off. Supports scheduled calls, delayed calls, and conversation-driven commits.

### 🔄 SMS Fallback
**Status:** Feature complete, waiting on Twilio A2P 10DLC approval

Automatic fallback to SMS when calls go unanswered. User can text "call me" to trigger a call back.

**See [docs/scheduled-calls.md](docs/scheduled-calls.md) for technical details**

## About This Project

This tool was built in one week, from "interesting idea" to "production-ready." Most of the development happened through voice conversations with Claude while doing other things - walking, cleaning, commuting. The tool helped build itself.

**This is a learning project.** It's not perfect, but it demonstrates:
- How quickly you can ship with AI assistance
- How much leverage voice-first workflows create
- How easy it is to interact with modern AI tools

**Copy this work.** Fit it to your workflow. Break it. Improve it. Share what you learn.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Make your changes
4. Submit a pull request

**Issues:** [GitHub Issues](https://github.com/CornelsonOrganization/call-me-cloud-public/issues)

## License

MIT License - see [LICENSE](LICENSE)

## Acknowledgments

- Inspired by the original [Call-Me](https://github.com/modelcontextprotocol/servers) MCP server
- Built with [Bun](https://bun.sh)
- Phone services by [Twilio](https://twilio.com)
- Speech services by [OpenAI](https://openai.com)
- Designed for the [Model Context Protocol](https://modelcontextprotocol.io)

---

**Pro tip:** After setup, add call-me-cloud to any repository in 2 minutes using GitHub Actions. See [QUICKSTART.md](QUICKSTART.md).
