# npm Publishing Guide for call-me-cloud-mcp

This guide ensures the MCP client package meets quality standards before publishing to npm.

## References

- [Official MCP SDK](https://www.npmjs.com/package/@modelcontextprotocol/sdk) - Reference implementation
- [MCP Server Development Guide](https://github.com/cyanheads/model-context-protocol-resources/blob/main/guides/mcp-server-development-guide.md) - Community best practices
- [Building MCP Clients](https://modelcontextprotocol.info/docs/tutorials/building-a-client-node/) - Official tutorial

## Current Status

| Check | Status | Notes |
|-------|--------|-------|
| Package name available | ✅ | `call-me-cloud-mcp` is not taken |
| package.json basics | ⚠️ | Missing some recommended fields |
| README | ❌ | No package-specific README |
| TypeScript compilation | ⚠️ | Ships raw .ts, relies on tsx runtime |
| Tests | ❌ | No test suite |
| License file | ❌ | LICENSE file not in mcp-client/ |

## Pre-Publishing Checklist

### 1. Required package.json Fields

```json
{
  "name": "call-me-cloud-mcp",
  "version": "1.0.0",
  "description": "MCP client for Call-Me Cloud - lets Claude call you via phone",
  "author": "Your Name <email@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/riverscornelson/call-me-cloud"
  },
  "homepage": "https://github.com/riverscornelson/call-me-cloud#readme",
  "bugs": {
    "url": "https://github.com/riverscornelson/call-me-cloud/issues"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**Currently missing**: `author`, `homepage`, `bugs`, `engines`

### 2. README.md (Required)

Create `mcp-client/README.md` with:

```markdown
# call-me-cloud-mcp

MCP (Model Context Protocol) client that enables Claude to make phone calls via Call-Me Cloud.

## Installation

Used automatically via npx in Claude Code configurations:

\`\`\`json
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
\`\`\`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CALLME_CLOUD_URL` | Yes | Your Call-Me Cloud server URL |
| `CALLME_API_KEY` | Yes | API key for authentication |

## Available Tools

- `initiate_call` - Start a phone call with the user
- `continue_call` - Send a follow-up message during a call
- `speak_to_user` - Speak without waiting for response
- `end_call` - End the call

## Requirements

- Node.js 18+
- A deployed Call-Me Cloud server

## License

MIT
\`\`\`

### 3. TypeScript Compilation Decision

**Option A: Ship compiled JavaScript (Recommended)**

Pros:
- Faster startup (no tsx compilation)
- Works on any Node.js without tsx
- Smaller install footprint
- Industry standard

Cons:
- Requires build step before publish

**Option B: Ship TypeScript with tsx (Current approach)**

Pros:
- Simpler development
- Source visible in node_modules

Cons:
- Requires tsx as dependency (larger install)
- Slower cold start
- Non-standard for npm packages

**Recommendation**: Switch to compiled JavaScript for production quality.

### 4. Build Setup (If switching to compiled JS)

Add to package.json:
```json
{
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  },
  "files": [
    "dist",
    "bin"
  ],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["index.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 5. Security Audit

Before publishing, run:
```bash
cd mcp-client
npm audit
```

Ensure no high/critical vulnerabilities in dependencies.

### 6. Test Locally

```bash
# Test the package works via npx
cd mcp-client
npm pack
npx ./call-me-cloud-mcp-1.0.0.tgz
```

## Publishing Steps

### First-Time Setup

1. **Create npm account** (if needed):
   ```bash
   npm adduser
   ```

2. **Enable 2FA** (required for new packages):
   - Go to npmjs.com → Account → Security
   - Enable two-factor authentication

### Publishing

1. **Verify you're logged in**:
   ```bash
   npm whoami
   ```

2. **Dry run first**:
   ```bash
   cd mcp-client
   npm publish --dry-run
   ```

   Review the file list - ensure no secrets, test files, or unnecessary files.

3. **Publish**:
   ```bash
   npm publish --access public
   ```

4. **Verify**:
   ```bash
   npm view call-me-cloud-mcp
   ```

## Version Management

Follow [Semantic Versioning](https://semver.org/):

- **1.0.0** → Initial release
- **1.0.1** → Bug fixes (patch)
- **1.1.0** → New features, backward compatible (minor)
- **2.0.0** → Breaking changes (major)

Before publishing updates:
```bash
npm version patch  # or minor, or major
npm publish
```

## MCP-Specific Standards

Based on official MCP SDK patterns and community guidelines:

### 1. Keywords (for npm discoverability)

```json
{
  "keywords": [
    "mcp",
    "model-context-protocol",
    "claude",
    "ai",
    "llm",
    "phone",
    "voice",
    "call"
  ]
}
```

### 2. Logging Best Practice

**Critical**: For stdio-based MCP servers, never write to stdout - it corrupts JSON-RPC messages.

Current code correctly uses `console.error()`:
```typescript
console.error('CallMe MCP Client ready');  // ✅ Correct
console.log('...');  // ❌ Would break MCP protocol
```

### 3. Zod Schema Validation

The MCP SDK uses Zod for schema validation. Current implementation uses basic TypeScript types. Consider upgrading to Zod schemas for better validation:

```typescript
import { z } from 'zod';

const InitiateCallSchema = z.object({
  message: z.string().describe('What you want to say to the user')
});
```

### 4. Error Handling

Return structured errors following MCP conventions:
```typescript
return {
  content: [{ type: 'text', text: `Error: ${errorMessage}` }],
  isError: true,  // ✅ Already implemented
};
```

### 5. Tool Descriptions

Current tool descriptions are good. Ensure they:
- Clearly state what the tool does
- Include when to use it
- Document required vs optional parameters

## Quality Standards Checklist

Before each publish, verify:

- [ ] All tests pass (when tests exist)
- [ ] `npm audit` shows no high/critical issues
- [ ] README is accurate and up-to-date
- [ ] Version number incremented appropriately
- [ ] CHANGELOG updated (for significant changes)
- [ ] Tested locally with `npm pack` + `npx`
- [ ] No secrets or sensitive data in files

## Recommended Improvements (Priority Order)

1. **Add package README** - Required for npm listing
2. **Add missing package.json fields** - Professional appearance
3. **Add basic test** - Even one integration test helps
4. **Consider compiled JS** - Better performance and compatibility
5. **Add CHANGELOG.md** - Track version history

## Quick Start (Minimum Viable Publish)

If you want to publish quickly with minimum changes:

```bash
cd mcp-client

# 1. Add README
echo "# call-me-cloud-mcp\n\nMCP client for Call-Me Cloud phone calls.\n\nSee: https://github.com/riverscornelson/call-me-cloud" > README.md

# 2. Login to npm
npm login

# 3. Dry run
npm publish --dry-run

# 4. Publish
npm publish --access public
```

This gets the package on npm. You can improve quality iteratively.
