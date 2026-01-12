#!/bin/bash
# Python Dependency Setup Script with Hash Verification
# Installs Python packages securely using pip's hash-checking mode
#
# Usage:
#   bash setup-python-deps.sh [requirements-file]
#
# Default requirements file: .github/requirements/office-skills.txt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REQUIREMENTS="$SCRIPT_DIR/../requirements/office-skills.txt"

# Colors for output (stderr only)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[PYTHON]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[PYTHON]${NC} $1" >&2; }
log_error() { echo -e "${RED}[PYTHON]${NC} $1" >&2; }

main() {
    local requirements_file="${1:-$DEFAULT_REQUIREMENTS}"

    log_info "=== Python Dependency Setup with Hash Verification ==="

    # Check if requirements file exists
    if [ ! -f "$requirements_file" ]; then
        log_warn "Requirements file not found: $requirements_file"
        log_warn "Run update-python-hashes.sh first to generate it"
        log_warn "Skipping Python dependency installation"

        # Output for GitHub Actions
        if [ -n "${GITHUB_OUTPUT:-}" ]; then
            echo "PYTHON_DEPS_INSTALLED=false" >> "$GITHUB_OUTPUT"
            echo "PYTHON_DEPS_COUNT=0" >> "$GITHUB_OUTPUT"
        fi
        return 0
    fi

    # Verify the requirements file contains hashes
    if ! grep -q "\-\-hash=sha256:" "$requirements_file"; then
        log_error "Requirements file does not contain hashes!"
        log_error "This is a security requirement."
        log_error "Regenerate with: bash .github/scripts/update-python-hashes.sh"
        exit 1
    fi

    log_info "Requirements file validated: $requirements_file"

    # Count packages (lines starting with alphanumeric, not comments)
    local package_count
    package_count=$(grep -c "^[a-zA-Z]" "$requirements_file" 2>/dev/null || echo "0")
    log_info "Installing $package_count packages with hash verification..."

    # Install with secure flags
    # --require-hashes: Enforce hash checking
    # --no-deps: Dependencies should be in the file (prevents transitive dep attacks)
    if pip install \
        --require-hashes \
        --no-deps \
        -r "$requirements_file" 2>&1; then
        log_info "All packages installed and verified successfully"
    else
        log_error "Package installation failed!"
        log_error "This could indicate:"
        log_error "  - Tampered package (hash mismatch)"
        log_error "  - Network issue"
        log_error "  - Missing dependency in requirements file"
        log_error "  - PyPI package was updated (regenerate hashes)"
        exit 1
    fi

    # Output for GitHub Actions
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        echo "PYTHON_DEPS_INSTALLED=true" >> "$GITHUB_OUTPUT"
        echo "PYTHON_DEPS_COUNT=$package_count" >> "$GITHUB_OUTPUT"
    fi

    log_info "=== Python Dependency Setup Complete ==="
}

main "$@"
