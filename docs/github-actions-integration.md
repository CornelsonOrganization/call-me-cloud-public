# GitHub Actions Integration

Call the user to report on build status, scheduled updates, or repo health—triggered directly from GitHub Actions.

## Architecture

```
GitHub Actions
     │
     ├─→ Claude Code CLI (with prompt)
     │        │
     │        └─→ MCP Client (stdio)
     │                 │
     │                 └─→ Railway Server (HTTPS)
     │                          │
     │                          └─→ Phone Call
     │
     └─→ [Alternative] Direct HTTP to Railway
```

Two approaches:

| Approach | Pros | Cons |
|----------|------|------|
| **Claude Code** | AI composes natural messages, interprets context | Requires Anthropic API key, ~30s startup |
| **Direct HTTP** | Fast, simple, no AI costs | Static message templates only |

## Approach 1: Claude Code (Recommended)

Claude interprets build results and has a natural conversation.

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key for Claude Code |
| `CALLME_API_KEY` | Your Call-Me Cloud API key |
| `CALLME_CLOUD_URL` | Your Railway server URL (e.g., `https://call-me-cloud.up.railway.app`) |

### Workflow File

```yaml
# .github/workflows/status-call.yml
name: Status Call

on:
  # Scheduled reports (e.g., daily standup)
  schedule:
    - cron: '0 9 * * 1-5'  # 9 AM UTC, weekdays

  # After deployments
  workflow_run:
    workflows: ["Deploy"]
    types: [completed]

  # Manual trigger
  workflow_dispatch:
    inputs:
      message:
        description: 'Custom message for the call'
        required: false

jobs:
  call:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Get repo context
        id: context
        run: |
          echo "repo=${{ github.repository }}" >> $GITHUB_OUTPUT
          echo "branch=${{ github.ref_name }}" >> $GITHUB_OUTPUT
          echo "sha=$(git rev-parse --short HEAD)" >> $GITHUB_OUTPUT
          echo "commit_msg=$(git log -1 --pretty=%s)" >> $GITHUB_OUTPUT

          # Get recent activity
          echo "recent_commits=$(git log --oneline -5 | tr '\n' ' | ')" >> $GITHUB_OUTPUT

          # Check if this is from a workflow_run
          if [ "${{ github.event_name }}" = "workflow_run" ]; then
            echo "trigger=workflow" >> $GITHUB_OUTPUT
            echo "workflow_status=${{ github.event.workflow_run.conclusion }}" >> $GITHUB_OUTPUT
            echo "workflow_name=${{ github.event.workflow_run.name }}" >> $GITHUB_OUTPUT
          else
            echo "trigger=${{ github.event_name }}" >> $GITHUB_OUTPUT
          fi

      - name: Setup Claude Code
        run: |
          npm install -g @anthropic-ai/claude-code

          # Configure MCP client
          mkdir -p ~/.claude
          cat > ~/.claude/settings.json << 'EOF'
          {
            "mcpServers": {
              "call-me-cloud": {
                "command": "npx",
                "args": ["-y", "call-me-cloud-mcp"],
                "env": {
                  "CALLME_CLOUD_URL": "${{ secrets.CALLME_CLOUD_URL }}",
                  "CALLME_API_KEY": "${{ secrets.CALLME_API_KEY }}"
                }
              }
            }
          }
          EOF

      - name: Call with status report
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          # Build the prompt based on trigger type
          if [ "${{ steps.context.outputs.trigger }}" = "workflow" ]; then
            PROMPT="Call the user to report that the ${{ steps.context.outputs.workflow_name }} workflow just ${{ steps.context.outputs.workflow_status }} for ${{ steps.context.outputs.repo }}.

            Latest commit: ${{ steps.context.outputs.commit_msg }}

            Keep it brief - just the essential status update. If they want details, offer to discuss."
          elif [ "${{ github.event_name }}" = "schedule" ]; then
            PROMPT="Call the user with a quick daily status update for ${{ steps.context.outputs.repo }}.

            Recent commits: ${{ steps.context.outputs.recent_commits }}
            Current branch: ${{ steps.context.outputs.branch }}

            Keep it conversational and brief. Ask if they want to discuss any of the recent changes."
          else
            # Manual trigger with optional custom message
            CUSTOM="${{ github.event.inputs.message }}"
            PROMPT="Call the user about ${{ steps.context.outputs.repo }}. ${CUSTOM:-Ask if they need any updates on the repo status.}"
          fi

          claude --print "$PROMPT"
```

### Prompt Templates

#### Build Status Report
```
Call the user to report that the {{workflow_name}} workflow just {{status}}
for {{repo}}.

Latest commit: {{commit_message}}

Keep it brief - just the essential status update. If they want details, offer
to discuss.
```

#### Daily Standup
```
Call the user with a quick daily status update for {{repo}}.

Recent commits:
{{recent_commits}}

Keep it conversational and brief. Ask if they want to discuss any of the
recent changes or priorities for today.
```

#### Deployment Complete
```
Call the user to let them know the deployment to {{environment}} just completed.

Changes deployed:
{{changelog}}

Ask if they want to verify anything or if there are immediate follow-ups.
```

## Approach 2: Direct HTTP (Simple)

Skip Claude Code entirely—just call the API directly for static messages.

### Workflow File

```yaml
# .github/workflows/simple-call.yml
name: Simple Status Call

on:
  workflow_run:
    workflows: ["Deploy"]
    types: [completed]

jobs:
  call:
    runs-on: ubuntu-latest
    steps:
      - name: Initiate call
        id: call
        run: |
          RESPONSE=$(curl -s -X POST "${{ secrets.CALLME_CLOUD_URL }}/api/call" \
            -H "Authorization: Bearer ${{ secrets.CALLME_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "message": "Hey, the ${{ github.event.workflow_run.name }} workflow just ${{ github.event.workflow_run.conclusion }} for ${{ github.repository }}. The latest commit was: ${{ github.event.workflow_run.head_commit.message }}. Let me know if you have any questions."
            }')

          echo "call_id=$(echo $RESPONSE | jq -r '.callId')" >> $GITHUB_OUTPUT

      - name: Wait for response and end call
        run: |
          # Wait a moment for user to respond, then end call
          sleep 30

          curl -s -X POST "${{ secrets.CALLME_CLOUD_URL }}/api/call/${{ steps.call.outputs.call_id }}/end" \
            -H "Authorization: Bearer ${{ secrets.CALLME_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{"message": "Alright, talk to you later!"}'
```

## Publishing the MCP Client to npm

For the Claude Code approach to work seamlessly, publish the MCP client as an npm package:

```bash
# In mcp-client/
npm publish --access public
```

Then users can reference it in their Claude settings as shown above.

## Security Considerations

1. **Secrets** - Store all keys in GitHub Secrets, never in workflow files
2. **Branch protection** - Limit which branches can trigger calls
3. **Rate limiting** - Add workflow concurrency limits to prevent spam
4. **Call hours** - Consider adding time-of-day checks to avoid late-night calls

```yaml
# Add to job
jobs:
  call:
    if: github.event.workflow_run.conclusion == 'failure'  # Only call on failures
    # Or check time of day in a step before calling
```

## Example: Call Only on Failures

```yaml
name: Failure Alert Call

on:
  workflow_run:
    workflows: ["CI", "Deploy"]
    types: [completed]

jobs:
  alert:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup and call
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npm install -g @anthropic-ai/claude-code

          claude --print "URGENT: Call the user immediately. The ${{ github.event.workflow_run.name }} workflow just FAILED for ${{ github.repository }}. This needs attention. Get their input on next steps."
```
