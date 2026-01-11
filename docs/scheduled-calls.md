# Dynamic Scheduled Calls via GitHub Actions

Schedule a call from your phone, then discuss and commit changes while walking.

## The Flow

```
You (on phone) → Claude → GitHub API → [delay] → GitHub Actions → Claude Code → Calls You → Commits to Branch
```

1. Tell Claude: "Schedule a call in 5 minutes to work on the auth refactor"
2. Claude triggers a GitHub workflow with your prompt
3. 5 minutes later, a fresh Claude session calls your phone
4. You discuss while walking, Claude implements and commits to a new branch

## Setup (One-Time)

### 1. Set GitHub Secrets

Using the GitHub CLI:

```bash
# Your Claude API key
gh secret set ANTHROPIC_API_KEY --repo your-username/your-repo

# Your Call-Me Cloud credentials
gh secret set CALLME_API_KEY --repo your-username/your-repo
gh secret set CALLME_CLOUD_URL --repo your-username/your-repo
```

Or via GitHub UI: Settings → Secrets and variables → Actions → New repository secret

### 2. Add the Workflow

Copy `.github/workflows/scheduled-call.yml` to your repo.

### 3. Create a Personal Access Token (for triggering from Claude)

GitHub Settings → Developer Settings → Personal Access Tokens → Generate new token (classic)
- Scope: `repo` (full control) and `workflow`
- Save this as an environment variable for Claude Code sessions

## Usage

### From a Claude Session (Phone or Desktop)

Tell Claude:
> "Schedule a call in 5 minutes to discuss refactoring the auth module.
> I want to split it into separate files for OAuth and JWT."

Claude will use the GitHub API to trigger the workflow:
```bash
gh workflow run scheduled-call.yml \
  --repo your-username/your-repo \
  -f delay_minutes=5 \
  -f prompt="Discuss refactoring the auth module. User wants to split into OAuth and JWT files." \
  -f branch="feat/auth-refactor"
```

### What Happens Next

1. GitHub Actions starts the workflow
2. Waits 5 minutes (the delay)
3. Spins up Claude Code with your prompt
4. Claude calls your phone
5. You discuss the changes while walking
6. Claude implements, commits to the branch you specified
7. You can review/merge the PR later

## Example Prompts

**Bug fix:**
> Schedule a call in 10 minutes. The login form validation is broken -
> it accepts empty passwords. Let's fix it and add tests.

**Feature discussion:**
> Call me in 5 minutes to work on adding dark mode. I want to discuss
> the approach before implementing.

**Code review:**
> In 3 minutes, call me to review the changes in PR #42. I want to
> walk through the security implications.
