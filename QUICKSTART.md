# Quick Start Guide

**Voice conversations for AI agents.** Let Claude call you on the phone for real-time voice discussions.

> **Recommended Setup:** Clone this repo and work with a coding agent (like Claude Code) to configure everything. The agent can help set up Railway, Twilio, environment variables, and troubleshoot issues in real-time.

## Prerequisites

You'll need accounts with these services (agent can help with setup):

| Service | Purpose | Cost |
|---------|---------|------|
| **[Railway](https://railway.app)** | Cloud hosting | Free tier: $5/month credit |
| **[Twilio](https://twilio.com)** | Phone service | ~$1/mo phone + $0.014/min calls |
| **[Anthropic](https://console.anthropic.com)** | Claude API (for GitHub Actions) | Usage-based pricing |
| **[OpenAI](https://platform.openai.com)** | Speech services | ~$0.06/min |

## Setup with a Coding Agent

### 1. Clone & Start Session

```bash
# Clone the repository
git clone https://github.com/CornelsonOrganization/call-me-cloud-public.git
cd call-me-cloud-public

# Start a coding agent session (example with Claude Code)
claude
```

### 2. Ask Your Agent to Help

```
Hey, I want to set up call-me-cloud so Claude can call me on the phone.
Can you help me:
1. Deploy this to Railway
2. Set up Twilio with a phone number
3. Configure all the environment variables
4. Test that it works
```

The agent will:
- Guide you through creating Railway and Twilio accounts
- Help you get API keys from each service
- Set up environment variables in Railway
- Configure Twilio webhooks
- Test the deployment
- Help troubleshoot any issues

### 3. Choose Your Integration

After setup, pick how you want to use it:

**Option A: GitHub Actions** (Works anywhere, even when laptop is off)
```bash
# Ask your agent to set this up
"Add the GitHub Actions workflow so Claude can call me from CI/CD"
```

**Option B: Local MCP** (Quick calls when near your laptop)
```bash
# Ask your agent to configure this
"Set up the MCP client so I can use this in my local Claude sessions"
```

## Your First Call

### With GitHub Actions:
```bash
gh workflow run call.yml -f prompt="Call me to discuss the project status"
```

### With Local MCP (in a Claude Code session):
```
You: Call me to discuss the project status
Claude: [Initiates phone call]
```

## Example Conversations

### Build Monitor
```bash
# Before going for a walk
gh workflow run call.yml -f delay_minutes=15 -f prompt="Monitor the CI build and call me when it finishes"
```

**Claude calls 15 mins later:** "Hey, the build finished successfully. All tests passed. Want me to merge to main?"

### Code Review During Commute
```bash
# Before leaving work
gh workflow run call.yml -f delay_minutes=10 -f prompt="Review the PR and discuss any concerns"
```

**Claude calls while you're driving:** "I reviewed the changes. Overall looks good, but I have concerns about the error handling in auth-controller.ts..."

### Dangerous Operation Approval
During a Claude Code session:
```
You: Force push the rebased branch to main, but call me first to confirm
Claude: [Calls] "I'm about to force push to main. This will overwrite commits from the last 2 hours. Should I proceed?"
You: "Did anyone else push recently?"
Claude: "Let me check... yes, Jamie pushed 20 minutes ago. I should rebase again first."
```

## Environment Variables Reference

Your coding agent will help set these, but here's the reference:

### Railway Deployment (Required)
```bash
CALLME_API_KEY=<generate with: openssl rand -base64 32>
CALLME_PHONE_ACCOUNT_SID=<from Twilio console>
CALLME_PHONE_AUTH_TOKEN=<from Twilio console>
CALLME_PHONE_NUMBER=<your Twilio number, format: +1XXXYYYZZZZ>
CALLME_USER_PHONE_NUMBER=<your personal phone, format: +1XXXYYYZZZZ>
CALLME_OPENAI_API_KEY=<from OpenAI platform>
```

### GitHub Actions (Optional)
Add as GitHub Secrets (Settings → Secrets → Actions):
- `ANTHROPIC_API_KEY`
- `CALLME_API_KEY` (same as Railway)
- `CALLME_CLOUD_URL` (your Railway URL)

### Local MCP (Optional)
Add to `~/.claude.json`:
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

## Troubleshooting with Your Agent

If something doesn't work, ask your agent:

```
"The call isn't connecting. Can you check:
1. Railway logs for errors
2. Twilio webhook configuration
3. Environment variables are set correctly"
```

Common issues:
- **No audio**: Check OpenAI API key has Realtime API access
- **Call fails**: Verify Twilio webhook is `https://YOUR-URL/twiml`
- **401 errors**: Ensure `CALLME_API_KEY` matches on client and server

## Next Steps

- **[Use Cases](docs/USE-CASES.md)** - 15 detailed scenarios with storyboards
- **[GitHub Actions Guide](docs/github-actions-integration.md)** - Advanced CI/CD workflows
- **[Full README](README.md)** - Complete documentation and API reference

## Support

- **Issues**: [GitHub Issues](https://github.com/CornelsonOrganization/call-me-cloud-public/issues)
- **Setup Help**: Work with a coding agent - they can read docs, check logs, and debug in real-time

---

**Pro tip:** After setup, ask your coding agent to add call-me-cloud to any repository's GitHub Actions. Takes 2 minutes and works everywhere.
