#!/bin/bash
# Plugin Repository Verification Script
# Ensures cloned plugins match the pinned commit hash
#
# Usage:
#   source verify-plugins.sh
#   verify_repository /path/to/repo
#   clone_and_verify /path/to/target
#   update_pin  # To update pinned commit

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../config/plugins-pinned.json"

# Colors for output (stderr only)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

_log_info() { echo -e "${GREEN}[VERIFY]${NC} $1" >&2; }
_log_warn() { echo -e "${YELLOW}[VERIFY]${NC} $1" >&2; }
_log_error() { echo -e "${RED}[VERIFY]${NC} $1" >&2; }

# Load pinned configuration
load_pinned_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        _log_error "Pinned configuration not found: $CONFIG_FILE"
        _log_error "Run '$0 update-pin' to create initial pin"
        return 1
    fi

    # Extract values using grep/sed (no jq dependency)
    PINNED_COMMIT=$(grep '"pinned_commit"' "$CONFIG_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/')
    PINNED_REPO=$(grep '"repository"' "$CONFIG_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/')

    # Validate commit hash format (40 hex characters)
    if [[ ! "$PINNED_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
        _log_error "Invalid pinned commit hash format: $PINNED_COMMIT"
        _log_error "Expected 40 hex characters"
        return 1
    fi

    if [ -z "$PINNED_REPO" ]; then
        _log_error "Repository URL not found in config"
        return 1
    fi
}

# Verify repository matches pinned commit
verify_repository() {
    local repo_dir="$1"

    if [ ! -d "$repo_dir/.git" ]; then
        _log_error "Not a git repository: $repo_dir"
        return 1
    fi

    load_pinned_config || return 1

    local current_commit
    current_commit=$(git -C "$repo_dir" rev-parse HEAD)

    if [ "$current_commit" != "$PINNED_COMMIT" ]; then
        _log_error "Plugin verification FAILED"
        _log_error "Expected commit: $PINNED_COMMIT"
        _log_error "Actual commit:   $current_commit"
        _log_error ""
        _log_error "This could indicate:"
        _log_error "  - Outdated pin (legitimate update needed)"
        _log_error "  - Tampered repository (security concern)"
        _log_error ""
        _log_error "To update the pinned commit, run:"
        _log_error "  $0 update-pin"
        return 1
    fi

    _log_info "Plugin repository verified: ${PINNED_COMMIT:0:8}..."
    return 0
}

# Clone and verify (atomic operation)
clone_and_verify() {
    local target_dir="$1"

    load_pinned_config || return 1

    _log_info "Cloning plugins at pinned commit: ${PINNED_COMMIT:0:8}..."

    # Clone the full repository (need full history for checkout)
    if ! git clone --quiet "$PINNED_REPO" "$target_dir" 2>&1; then
        _log_error "Failed to clone repository: $PINNED_REPO"
        return 1
    fi

    # Checkout the pinned commit
    if ! git -C "$target_dir" checkout --quiet "$PINNED_COMMIT" 2>&1; then
        _log_error "Failed to checkout pinned commit: $PINNED_COMMIT"
        rm -rf "$target_dir"
        return 1
    fi

    # Verify the checkout succeeded
    verify_repository "$target_dir"
}

# Update pinned commit (for maintenance)
update_pin() {
    local repo_url="${1:-https://github.com/anthropics/claude-plugins-official.git}"
    local temp_dir
    temp_dir=$(mktemp -d)

    _log_info "Fetching latest commit from $repo_url"

    if ! git clone --depth 1 --quiet "$repo_url" "$temp_dir" 2>&1; then
        _log_error "Failed to clone repository"
        rm -rf "$temp_dir"
        return 1
    fi

    local latest_commit
    latest_commit=$(git -C "$temp_dir" rev-parse HEAD)
    local commit_date
    commit_date=$(git -C "$temp_dir" log -1 --format=%cI)
    local commit_msg
    commit_msg=$(git -C "$temp_dir" log -1 --format=%s | head -c 100)

    _log_info "Latest commit: $latest_commit"
    _log_info "Commit date: $commit_date"
    _log_info "Commit message: $commit_msg"

    # Generate new config
    local config_dir
    config_dir=$(dirname "$CONFIG_FILE")
    mkdir -p "$config_dir"

    cat > "$CONFIG_FILE" << EOF
{
  "repository": "$repo_url",
  "pinned_commit": "$latest_commit",
  "pinned_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pinned_by": "${GIT_AUTHOR_EMAIL:-$(git config user.email 2>/dev/null || echo "unknown")}",
  "verification_method": "commit_hash",
  "commit_date": "$commit_date",
  "commit_message": "$(echo "$commit_msg" | sed 's/"/\\"/g')",
  "notes": "Verify this commit is from Anthropic before committing"
}
EOF

    _log_info "Updated $CONFIG_FILE"
    echo ""
    echo "IMPORTANT: Before committing, verify this commit is legitimate:"
    echo "  1. Check https://github.com/anthropics/claude-plugins-official/commits/main"
    echo "  2. Verify the commit matches expected changes"
    echo "  3. Commit this change with a descriptive message"

    rm -rf "$temp_dir"
}

# CLI interface when run directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    case "${1:-}" in
        verify)
            verify_repository "${2:-.}"
            ;;
        clone)
            clone_and_verify "${2:-/tmp/claude-plugins}"
            ;;
        update-pin)
            update_pin "${2:-}"
            ;;
        *)
            echo "Usage: $0 {verify|clone|update-pin} [path|url]"
            echo ""
            echo "Commands:"
            echo "  verify [path]     Verify repository at path matches pinned commit"
            echo "  clone [path]      Clone and verify to path (default: /tmp/claude-plugins)"
            echo "  update-pin [url]  Update pinned commit from repository"
            exit 1
            ;;
    esac
fi
