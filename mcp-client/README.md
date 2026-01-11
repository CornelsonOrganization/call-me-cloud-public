# call-me-cloud-mcp

MCP (Model Context Protocol) client that enables Claude to make phone calls via [Call-Me Cloud](https://github.com/riverscornelson/call-me-cloud).

## What is this?

This package lets Claude Code call you on the phone. It connects to a Call-Me Cloud server (which you deploy) and provides MCP tools for initiating and managing voice calls.

## Installation

Used automatically via npx in Claude Code configurations. Add to your MCP settings:

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CALLME_CLOUD_URL` | Yes | Your Call-Me Cloud server URL |
| `CALLME_API_KEY` | Yes | API key for authentication |

## Available Tools

### `initiate_call`
Start a phone call with the user.

```
initiate_call({ message: "Hey, I finished the refactor. Want me to walk through it?" })
```

Returns: `{ callId, response }` - The call ID and the user's spoken response.

### `continue_call`
Send a follow-up message and wait for response.

```
continue_call({ call_id: "call-1", message: "Should I also update the tests?" })
```

### `speak_to_user`
Speak a message without waiting for a response.

```
speak_to_user({ call_id: "call-1", message: "Give me a moment to check that..." })
```

### `end_call`
End the call with a closing message.

```
end_call({ call_id: "call-1", message: "Sounds good, I'll get started. Talk soon!" })
```

## Requirements

- Node.js 18+
- A deployed [Call-Me Cloud](https://github.com/riverscornelson/call-me-cloud) server
- Twilio or Telnyx account for phone calls
- OpenAI API key (for speech-to-text and text-to-speech)

## How It Works

```
Claude Code  -->  This MCP Client  -->  Your Cloud Server  -->  Phone Call
   (stdio)          (REST API)           (Twilio/Telnyx)        (to you)
```

1. Claude decides to call you using one of the MCP tools
2. This client forwards the request to your cloud server
3. The server initiates a phone call via Twilio/Telnyx
4. Audio is processed through OpenAI's real-time API
5. Your response is transcribed and returned to Claude

## Server Setup

See the main [Call-Me Cloud repository](https://github.com/riverscornelson/call-me-cloud) for server deployment instructions.

## License

MIT
