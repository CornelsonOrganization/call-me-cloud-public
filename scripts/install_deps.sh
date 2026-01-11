#!/bin/bash

# Install dependencies for call-me-cloud
# This script runs on Claude Code SessionStart

# Only run in remote environments (Claude Code on the web)
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

echo "Installing dependencies..."

# Install Node.js dependencies with bun
bun install

echo "Dependencies installed successfully"
exit 0
