#!/bin/bash
set -euo pipefail

# Claude Code Plugin Setup Script
# Three-tier plugin loading system:
# 1. Core defaults (always loaded)
# 2. Auto-detected language LSPs (based on repo files)
# 3. Optional additional plugins (from workflow input)

PLUGINS_DIR="/tmp/claude-plugins"
OFFICIAL_REPO="https://github.com/anthropics/claude-plugins-official.git"
OFFICIAL_REPO_DIR="$PLUGINS_DIR/claude-plugins-official"
MARKETPLACE_NAME="claude-plugins-official"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# CRITICAL: All log functions output to stderr to prevent log contamination
# When using command substitution $(...), stdout is captured as the return value
# Log messages to stdout would be incorrectly treated as plugin names
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Create plugins directory
mkdir -p "$PLUGINS_DIR"

# Source verification script for commit hash pinning
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_SCRIPT="$SCRIPT_DIR/verify-plugins.sh"

# Clone and verify official plugins repository
# SECURITY: Uses commit hash pinning to prevent supply chain attacks
log_info "Setting up official plugins repository with verification..."

# Check if verification should be skipped (development only - NOT in CI)
if [ "${SKIP_PLUGIN_VERIFICATION:-}" = "true" ]; then
    # SECURITY: Block this bypass in GitHub Actions to prevent abuse
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        log_error "SECURITY: SKIP_PLUGIN_VERIFICATION cannot be used in GitHub Actions"
        log_error "This bypass is only allowed for local development"
        exit 1
    fi

    log_warn "SECURITY WARNING: Plugin verification is DISABLED"
    log_warn "This should only be used for development/testing"

    if [ -d "$OFFICIAL_REPO_DIR" ]; then
        log_warn "Using existing unverified repository"
    else
        if ! git clone --depth 1 --quiet "$OFFICIAL_REPO" "$OFFICIAL_REPO_DIR"; then
            log_error "Failed to clone official plugins repository from $OFFICIAL_REPO"
            exit 1
        fi
        log_warn "Cloned repository WITHOUT verification"
    fi
elif [ -f "$VERIFY_SCRIPT" ]; then
    # Source verification functions
    source "$VERIFY_SCRIPT"

    if [ -d "$OFFICIAL_REPO_DIR" ]; then
        log_info "Plugins repository exists, verifying integrity..."
        if ! verify_repository "$OFFICIAL_REPO_DIR"; then
            log_warn "Verification failed - re-cloning from pinned commit..."
            rm -rf "$OFFICIAL_REPO_DIR"
            if ! clone_and_verify "$OFFICIAL_REPO_DIR"; then
                log_error "Failed to clone verified plugins repository"
                exit 1
            fi
        fi
        log_info "Plugin repository verified successfully"
    else
        if ! clone_and_verify "$OFFICIAL_REPO_DIR"; then
            log_error "Failed to clone and verify official plugins repository"
            exit 1
        fi
        log_info "Cloned and verified official plugins repository"
    fi
else
    # SECURITY: Fail closed - missing verification script is a security concern
    log_error "Verification script not found: $VERIFY_SCRIPT"
    log_error "Cannot proceed without plugin verification (security requirement)"
    log_error ""
    log_error "To fix:"
    log_error "  1. Ensure .github/scripts/verify-plugins.sh exists"
    log_error "  2. Or set SKIP_PLUGIN_VERIFICATION=true for local development only"
    exit 1
fi

# Tier 1: Core default plugins (always loaded)
CORE_PLUGINS=(
    "code-review"
    "pr-review-toolkit"
    "security-guidance"
    "agent-sdk-dev"
)

# Tier 2: Language-specific LSP plugins (auto-detected)
declare -A LSP_PLUGINS=(
    ["typescript-lsp"]="ts,tsx,js,jsx,mjs,cjs"
    ["pyright-lsp"]="py,pyi"
    ["gopls-lsp"]="go"
    ["rust-analyzer-lsp"]="rs"
    ["jdtls-lsp"]="java"
    ["clangd-lsp"]="c,cpp,cc,cxx,h,hpp"
    ["csharp-lsp"]="cs"
    ["kotlin-lsp"]="kt,kts"
    ["swift-lsp"]="swift"
    ["php-lsp"]="php"
    ["lua-lsp"]="lua"
)

# Detect languages in repository
# Outputs plugin names separated by newlines for safe array capture
detect_languages() {
    local repo_root="${1:-.}"

    log_info "Detecting languages in repository..."

    for plugin in "${!LSP_PLUGINS[@]}"; do
        local extensions="${LSP_PLUGINS[$plugin]}"
        local found=false

        # Split extensions by comma and check each
        IFS=',' read -ra EXTS <<< "$extensions"
        for ext in "${EXTS[@]}"; do
            # Search for files with this extension (excluding node_modules, .git, etc.)
            # Limit depth to 5 to avoid slow scans on large monorepos
            if find "$repo_root" -maxdepth 5 -type f -name "*.$ext" \
                -not -path "*/node_modules/*" \
                -not -path "*/.git/*" \
                -not -path "*/dist/*" \
                -not -path "*/build/*" \
                -not -path "*/.next/*" \
                -print -quit 2>/dev/null | grep -q .; then
                found=true
                break
            fi
        done

        if [ "$found" = true ]; then
            log_info "Detected language: $plugin (extensions: $extensions)"
            # Output one plugin per line for safe capture
            echo "$plugin"
        fi
    done
}

# Validate plugin exists in official repository
# Returns 0 and echoes path if valid, returns 1 if invalid
validate_plugin() {
    local plugin_name="$1"

    # Check both plugins and external_plugins directories
    for base_dir in "plugins" "external_plugins"; do
        local plugin_path="$OFFICIAL_REPO_DIR/$base_dir/$plugin_name"
        if [ -d "$plugin_path" ]; then
            # LSP plugins (typescript-lsp, pyright-lsp, etc.) don't have manifests
            # They're virtual plugins defined in marketplace.json
            # Just verify the directory exists
            echo "$plugin_path"
            return 0
        fi
    done

    log_error "Plugin '$plugin_name' not found in official repository"
    return 1
}

# Build plugin paths array
# Outputs paths separated by newlines for safe array capture
build_plugin_paths() {
    local plugins=("$@")

    for plugin in "${plugins[@]}"; do
        # Use || true to prevent set -e from exiting on validation failure
        local plugin_path
        if plugin_path=$(validate_plugin "$plugin"); then
            if [ -n "$plugin_path" ]; then
                log_info "Added plugin: $plugin"
                echo "$plugin_path"
            fi
        else
            log_warn "Skipping invalid plugin: $plugin"
        fi
    done
}

# Main execution
main() {
    local repo_root="${1:-.}"
    local additional_plugins_str="${2:-}"

    # Validate we're running in GitHub Actions
    if [ -z "${GITHUB_OUTPUT:-}" ]; then
        log_error "GITHUB_OUTPUT not set - are we running in GitHub Actions?"
        exit 1
    fi

    log_info "=== Claude Code Plugin Setup ==="
    log_info "Repository: $repo_root"

    # Tier 1: Core plugins
    log_info "Tier 1: Loading core plugins..."
    local all_plugins=("${CORE_PLUGINS[@]}")

    # Tier 2: Auto-detected language plugins
    # Use mapfile for safe array capture (avoids word-splitting issues)
    log_info "Tier 2: Auto-detecting language plugins..."
    local detected=()
    while IFS= read -r line; do
        [ -n "$line" ] && detected+=("$line")
    done < <(detect_languages "$repo_root")

    if [ ${#detected[@]} -gt 0 ]; then
        all_plugins+=("${detected[@]}")
    fi

    # Tier 3: Additional plugins from workflow input
    if [ -n "$additional_plugins_str" ]; then
        log_info "Tier 3: Adding custom plugins..."
        # Sanitize: remove dangerous characters, split by comma
        # Note: hyphen placed at end of character class for safety
        local sanitized
        sanitized=$(echo "$additional_plugins_str" | tr -cd 'a-zA-Z0-9,_-')
        IFS=',' read -ra ADDITIONAL <<< "$sanitized"
        for plugin in "${ADDITIONAL[@]}"; do
            if [ -n "$plugin" ]; then
                all_plugins+=("$plugin")
                log_info "Added custom plugin: $plugin"
            fi
        done
    fi

    # Remove duplicates using associative array (safer than word-splitting)
    declare -A seen_plugins
    local unique_plugins=()
    for plugin in "${all_plugins[@]}"; do
        if [ -z "${seen_plugins[$plugin]:-}" ]; then
            seen_plugins[$plugin]=1
            unique_plugins+=("$plugin")
        fi
    done

    log_info "Total unique plugins to load: ${#unique_plugins[@]}"

    # Build and validate plugin paths using safe array capture
    local plugin_paths=()
    while IFS= read -r line; do
        [ -n "$line" ] && plugin_paths+=("$line")
    done < <(build_plugin_paths "${unique_plugins[@]}")

    if [ ${#plugin_paths[@]} -eq 0 ]; then
        log_error "No valid plugins found"
        exit 1
    fi

    log_info "Successfully configured ${#plugin_paths[@]} plugins"

    # Output plugin names (newline-separated) for GitHub Actions
    local plugin_names=()
    for path in "${plugin_paths[@]}"; do
        local plugin_name
        plugin_name=$(basename "$path")
        plugin_names+=("$plugin_name")
    done

    # Sanity checks - max 50 plugins to catch script bugs
    if [ ${#plugin_names[@]} -gt 50 ]; then
        log_error "Suspiciously high plugin count (${#plugin_names[@]}). Possible script error."
        exit 1
    fi

    if [ ${#plugin_names[@]} -eq 0 ]; then
        log_error "No plugins configured. At minimum, core plugins should be loaded."
        exit 1
    fi

    # Validate plugin names are in valid format (alphanumeric, underscore, hyphen only)
    for name in "${plugin_names[@]}"; do
        if [[ ! "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
            log_error "Invalid plugin name detected: '$name'"
            exit 1
        fi
    done

    # Output to GitHub Actions using unique delimiter to prevent collision
    # Format: plugin-name@marketplace-name (one per line)
    local delimiter="PLUGINS_EOF_$(date +%s)"
    {
        echo "PLUGIN_NAMES<<${delimiter}"
        for name in "${plugin_names[@]}"; do
            echo "${name}@${MARKETPLACE_NAME}"
        done
        echo "${delimiter}"
    } >> "$GITHUB_OUTPUT"

    # Output marketplace as Git URL (claude-code-action expects Git URLs)
    echo "PLUGIN_MARKETPLACE=$OFFICIAL_REPO" >> "$GITHUB_OUTPUT"

    # Also output count for display
    echo "PLUGIN_COUNT=${#plugin_names[@]}" >> "$GITHUB_OUTPUT"

    log_info "=== Plugin Setup Complete ==="
    log_info "Marketplace: $MARKETPLACE_NAME ($OFFICIAL_REPO)"
    log_info "Plugins configured: ${#plugin_names[@]}"
}

# Execute main function
main "$@"
