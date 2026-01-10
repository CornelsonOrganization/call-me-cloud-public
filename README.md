# Call-Me Cloud

A cloud-hosted version of [call-me](https://github.com/ZeframLou/call-me) designed for VPN-restricted environments where ngrok tunneling doesn't work.

## Architecture

```
┌─────────────────┐     HTTPS      ┌─────────────────┐     Webhooks     ┌─────────────┐
│  Claude Code    │ ───────────▶  │  Railway Cloud  │ ◀──────────────  │   Twilio    │
│  (MCP Client)   │                │  (call-me)      │ ───────────────▶ │             │
│  Your Laptop    │                │                 │   Voice/Audio    │             │
└─────────────────┘                └─────────────────┘                  └─────────────┘
        │                                  │
        │ VPN allows                       │ Public URL
        │ outbound HTTPS                   │ (no tunnel needed)
        ▼                                  ▼
```

## Setup

### Step 1: Deploy to Railway

1. Go to [railway.app](https://railway.app) and sign in
2. Click "New Project" → "Deploy from GitHub repo"
3. Connect this repository (or use "Deploy from local")
4. Add environment variables:

| Variable | Value |
|----------|-------|
| `CALLME_PHONE_ACCOUNT_SID` | Your Twilio Account SID |
| `CALLME_PHONE_AUTH_TOKEN` | Your Twilio Auth Token |
| `CALLME_PHONE_NUMBER` | Your Twilio phone number (+1...) |
| `CALLME_USER_PHONE_NUMBER` | Your personal phone number (+1...) |
| `CALLME_OPENAI_API_KEY` | Your OpenAI API key |
| `CALLME_API_KEY` | A random secret for API auth (generate one) |

5. Deploy and note your Railway URL (e.g., `https://call-me-cloud-production.up.railway.app`)

### Step 2: Configure Twilio Webhook

1. Go to Twilio Console → Phone Numbers → Your Number
2. Under "Voice & Fax", set:
   - **A call comes in:** Webhook
   - **URL:** `https://YOUR-RAILWAY-URL/twiml`
   - **HTTP:** POST

### Step 3: Install Local MCP Client

```bash
cd mcp-client
bun install
```

### Step 4: Add to Claude Code

```bash
claude mcp add call-me -- bun run --cwd /path/to/call-me-cloud/mcp-client index.ts
```

Then add environment variables to your Claude settings (`.claude.json`):

```json
{
  "mcpServers": {
    "call-me": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "--cwd", "/path/to/call-me-cloud/mcp-client", "index.ts"],
      "env": {
        "CALLME_CLOUD_URL": "https://YOUR-RAILWAY-URL",
        "CALLME_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Step 5: Test

Restart Claude Code and try:
```
Call me
```

## Environment Variables

### Cloud Server (Railway)

| Variable | Required | Description |
|----------|----------|-------------|
| `CALLME_PHONE_ACCOUNT_SID` | Yes | Twilio Account SID |
| `CALLME_PHONE_AUTH_TOKEN` | Yes | Twilio Auth Token |
| `CALLME_PHONE_NUMBER` | Yes | Twilio phone number to call from |
| `CALLME_USER_PHONE_NUMBER` | Yes | Your phone number to receive calls |
| `CALLME_OPENAI_API_KEY` | Yes | OpenAI API key for TTS/STT |
| `CALLME_API_KEY` | Yes | Secret key for API authentication |
| `PORT` | Auto | Set by Railway |

### Local MCP Client

| Variable | Required | Description |
|----------|----------|-------------|
| `CALLME_CLOUD_URL` | Yes | Your Railway deployment URL |
| `CALLME_API_KEY` | Yes | Same API key as cloud server |

## API Endpoints

The cloud server exposes these REST endpoints:

- `POST /api/call` - Initiate a call
- `POST /api/call/:id/continue` - Continue a call
- `POST /api/call/:id/speak` - Speak without waiting
- `POST /api/call/:id/end` - End a call
- `GET /api/health` - Health check

All endpoints require `Authorization: Bearer YOUR_API_KEY` header.

## Costs

| Service | Cost |
|---------|------|
| Railway | Free tier: $5/month credit |
| Twilio (1 min) | ~$0.04 |
| OpenAI TTS/STT (1 min) | ~$0.02 |

## Troubleshooting

**"Could not reach cloud server"**
- Check your Railway deployment is running
- Verify CALLME_CLOUD_URL is correct (include https://)
- Check CALLME_API_KEY matches on both ends

**Call connects but no audio**
- Verify OpenAI API key has Realtime API access
- Check Railway logs for errors

**Twilio webhook errors**
- Ensure webhook URL is set to `https://YOUR-URL/twiml`
- Check Railway logs for incoming webhook requests
